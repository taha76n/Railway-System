import mongoose from "mongoose";
import { IdempotencyRecord } from "../../../inventory-service/src/models/idempotencyRecord.model";
import { logger } from "../configs/logger.js";
import Booking from "../models/booking.model.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/error.js";
import { inventoryClient } from "./inventoryClient.js";
import BookingSeat from "../models/bookingSeat.model.js";
import Passenger from "../models/passenger.model.js";
import { sagaService } from "./saga.service.js";
import { config } from "../configs/index.js";
import { userClient } from "./userClient.js";
import { stationClient } from "./stationClient.js";
import { paymentClient } from "./paymentClient.js";

const casUpdateBooking = async (bookingId, expectedVersion, data) => {
  const result = await Booking.updateOne(
    { _id: bookingId, __v: expectedVersion }, // same compound filter idea
    { $set: data, $inc: { __v: 1 } }
  );

  if (result.matchedCount === 0) {
    throw new StaleStateError(
      `Booking ${bookingId} was modified by another process (expected version ${expectedVersion})`
    );
  }

  return result;
};

const checkIdempotency = async (key) => {
  const existing = await IdempotencyRecord.findOne({ eventKey: key });
  if (existing) {
    logger.info(`Idempotent Request: ${key}`);
    return existing.response;
  }
  return null;
};

const saveIdempotency = async (key, response) => {
  await IdempotencyRecord.create({
    eventKey: key,
    response: response,
  });
};

const fetchUserForNotification = async (userId) => {
  try {
    const user = await userClient.getUserById(userId);

    return user ? { email: user.email, firstName: user.firstName } : {};
  } catch (error) {
    logger.error(`Failed to enrich booking event with user details`, {
      userId,
      error: error.message,
    });
    return {};
  }
};

const fetchStationName = async (stationId) => {
  if (stationId) {
    return null;
  }
  try {
    const station = await stationClient.getStationById(stationId);
    return station ? station.name : null;
  } catch (error) {
    logger.error(`Failed to enrich booking event with station name`, {
      stationId,
      error: error.message,
    });
    return null;
  }
};

const createBooking = async (
  userId,
  scheduleId,
  seatIds,
  passengers,
  idempotencyKey,
  fromStationId,
  toStationId,
  fromSeq,
  toSeq
) => {
  // ─── 1. INPUT VALIDATION ──────────────────────────────────────────────────
  // These checks are deliberately first and cheap — no DB, no network.
  // Reject garbage early before we spend a single millisecond on real work.

  if (
    !scheduleId ||
    !seatIds ||
    !Array.isArray(seatIds) ||
    seatIds.length === 0
  ) {
    // seatIds must exist AND be a non-empty array. typeof check isn't enough
    // because someone could pass a string "S1" which would pass !seatIds but
    // fail Array.isArray — we'd then crash later on .sort(). Fail loudly here.
    throw new BadRequestError(
      "ScheduleId and seatIds (non-empty array) are required"
    );
  }

  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
    throw new BadRequestError("passengers (non-empty array) is required");
  }

  if (seatIds.length !== passengers.length) {
    // Every seat needs exactly one passenger. 3 seats, 2 passengers = who sits in seat 3?
    // We enforce this upfront so we never build a partial passenger list in the DB.
    throw new BadRequestError(
      "Number of seats must match number of passengers"
    );
  }

  if (!idempotencyKey) {
    // Without this, a network timeout could cause the client to retry and
    // create two bookings. The key is how we detect "I've already done this".
    throw new BadRequestError("idempotencyKey is required");
  }

  // Segment booking validation — only applies when boarding/alighting stops are provided.
  // fromSeq=3, toSeq=5 → 3 >= 5 is false → valid, no throw.
  // fromSeq=5, toSeq=3 → 5 >= 3 is true  → invalid, train doesn't go backwards.
  // fromSeq=3, toSeq=3 → 3 >= 3 is true  → invalid, can't board and exit at same stop.
  if (fromSeq && toSeq && fromSeq >= toSeq) {
    throw new BadRequestError(
      "fromStation must come before toStation in route"
    );
  }

  // ─── 2. IDEMPOTENCY CHECK ─────────────────────────────────────────────────
  // If this exact idempotencyKey was used before AND the booking completed,
  // return the cached response immediately — don't create a second booking.
  // This handles the case where the client retried after a timeout.
  // We prefix with "booking:" to namespace keys if other services use the same store.

  // BUG YOU HAD: you wrote checkIdempotency(idempotencyKey) — missing the "booking:" prefix.
  // That means a payment idempotency key "abc" and a booking key "abc" would collide.
  const cached = await checkIdempotency(`booking:${idempotencyKey}`);
  if (cached) return cached;
  // ^ if we return here, nothing below runs. Early exit is clean.

  // ─── 3. SCHEDULE AND SEAT AVAILABILITY ───────────────────────────────────
  // Two HTTP calls to the inventory service. We do this BEFORE acquiring any
  // locks — locks are expensive (Redis round trip + TTL), so we only grab them
  // after we know the schedule is valid and the seats look available.
  const availability = await inventoryClient.getAvailability(scheduleId);

  if (availability.status !== "ACTIVE") {
    // Schedule could be CANCELLED, COMPLETED, or SUSPENDED. All = not bookable.
    throw new BadRequestError("Schedule is not active");
  }

  if (new Date(availability.departureDate) < new Date()) {
    // new Date() with no args = right now. If departure is in the past, reject.
    // The inventory service should also enforce this, but we check here too
    // so the error message is meaningful at the booking layer.
    throw new BadRequestError("Cannot book a train that has already departed");
  }

  // Fetch seats with segment awareness. If fromSeq/toSeq are provided, the
  // inventory service will compute segmentStatus per seat — availability for
  // YOUR specific segment only (not the whole train journey).
  // || undefined: converts null/0/false to undefined so axios omits the param
  // from the query string entirely rather than sending ?fromSeq=null.
  const seatData = await inventoryClient.getSeats(scheduleId, {
    fromSeq: fromSeq || undefined,
    toSeq: toSeq || undefined,
  });

  // Convert the seats array into a Map keyed by seatId.
  // Why: we're about to do one lookup per requested seat. Array.find() is O(n)
  // per lookup. Map.get() is O(1). For 200 seats and 4 requested: 4 vs up to 800
  // comparisons. Build once here, pay nothing per lookup below.
  const seatMap = new Map(seatData.seats.map((s) => [s.seatId, s]));

  // ─── 4. VALIDATE REQUESTED SEATS ─────────────────────────────────────────
  // Walk each requested seatId, verify it exists and is available,
  // accumulate the seat objects (for DB insert) and total fare.

  const bookingSeats = [];
  let totalAmount = 0;

  for (const seatId of seatIds) {
    const seat = seatMap.get(seatId);

    if (!seat) {
      // seatId came from the client but isn't in this schedule at all.
      // Could be a stale UI, wrong scheduleId, or fabricated request.
      throw new NotFoundError(`Seat ${seatId} not found in schedule`);
    }

    const isAvailable =
      fromSeq && toSeq && seat.segmentStatus !== undefined
        ? seat.segmentStatus === "AVAILABLE" // segment booking: use computed overlap status
        : seat.status === "AVAILABLE"; // full-route booking: use global seat status

    if (!isAvailable) {
      // Fail fast on the first unavailable seat. No point continuing —
      // we need ALL seats or none (all-or-nothing booking).
      throw new ConflictError(
        `Seat Number ${seat.seatNumber} is not available for this segment`,
        "SEATS_UNAVAILABLE"
      );
    }

    bookingSeats.push(seat);
    totalAmount += seat.price;
  }

  // ─── 5. SORT SEAT IDS (DEADLOCK PREVENTION) ───────────────────────────────
  // If two concurrent requests want seats [S3, S1] and [S1, S3], and each
  // tries to lock in their own order, they can deadlock: A holds S3 waiting
  // for S1, B holds S1 waiting for S3. Sorting guarantees both always try to
  // acquire locks in the same order — S1 then S3 — so one waits instead of deadlocking.

  const sortedSeatIds = [...seatIds].sort();

  // ─── 6. ACQUIRE REDIS DISTRIBUTED LOCKS ──────────────────────────────────
  // This is the concurrency guard that prevents two users from booking the
  // same seat simultaneously. A Lua script in Redis atomically acquires ALL
  // locks or NONE — no partial locking possible.

  const { acquired, lockValue } = await acquireSeatLocks(
    scheduleId,
    sortedSeatIds,
    `pre-${Date.now()}`, // temp booking ID — real _id doesn't exist yet
    config.BOOKING_TTL_SECONDS,
    fromSeq, // included in the lock key for segment-aware locking
    toSeq
  );

  if (!acquired) {
    // Another user is mid-booking for one or more of these seats right now.
    // Don't wait — fail immediately. Client should show "try again" UI.
    // Redis lock TTL means this resolves itself in seconds if the other user
    // doesn't complete (their lock expires and these seats become lockable again).
    throw new ConflictError(
      "One or more seats are being booked by another user. Please try again.",
      "SEATS_LOCKED"
    );
  }

  // ─── 7. SAGA EXECUTION ───────────────────────────────────────────────────
  // Everything from here can fail partway through — we might write the booking
  // to DB, then fail to hold seats in inventory, etc.
  // The try/catch below is the saga's safety net: if ANYTHING throws after we
  // have a booking record, we compensate (undo completed steps) and release locks.
  //
  // IMPORTANT: `booking` is declared outside try so the catch block can read it.
  // If booking creation itself fails, booking stays undefined and we skip compensation.

  let booking;

  try {
    // ── 7a. Write booking + seats + passengers atomically ─────────────────
    // lockExpiresAt tells the expiry job when to give up waiting for payment.
    // Computed here (not in the schema default) because we need it for the
    // response too, and the clock should start from this exact moment.
    const lockExpiresAt = new Date(
      Date.now() + config.BOOKING_TTL_SECONDS * 1000
    );

    // MongoDB session + withTransaction:
    // - withTransaction handles commit, abort, and retry on transient errors automatically
    // - Every operation inside must receive { session } or it runs outside the transaction
    // - If any operation throws, withTransaction aborts — all three writes roll back atomically
    // - This replicates what Prisma's nested create was doing silently under the hood
    const session = await mongoose.startSession();

    await session.withTransaction(async () => {
      // Booking.create with session requires an ARRAY wrapping — Mongoose's API
      // requirement when a session is provided. Without the array, session is silently ignored.
      const [createdBooking] = await Booking.create(
        [
          {
            userId,
            scheduleId,
            trainId: availability.trainId,
            trainNumber: availability.trainNumber,
            trainName: availability.trainName,
            departureDate: new Date(availability.departureDate),
            status: "PENDING",
            totalAmount,
            seatCount: seatIds.length,
            fromStationId: fromStationId || null, // null if full-route booking
            toStationId: toStationId || null,
            fromSeq: fromSeq || null, // stored so compensateHoldSeats can read them
            toSeq: toSeq || null, // without needing them passed in again
            idempotencyKey,
            lockExpiresAt,
          },
        ],
        { session }
      );

      // insertMany is a single round trip for all seats — faster than N individual creates.
      // Each seat gets bookingId so we can query them later with find({ bookingId }).
      // The (seat, index) => pattern: index param is available but intentionally unused here.
      await BookingSeat.insertMany(
        bookingSeats.map((seat) => ({
          bookingId: createdBooking._id,
          seatId: seat.seatId,
          seatNumber: seat.seatNumber,
          seatType: seat.seatType,
          price: seat.price,
        })),
        { session }
      );

      // Passengers use the ORIGINAL seatIds order (not sortedSeatIds) — the user
      // submitted passengers in the same order as seatIds, so passenger[0] goes
      // with seatIds[0]. sortedSeatIds is only for lock ordering.
      await Passenger.insertMany(
        passengers.map((p, index) => ({
          bookingId: createdBooking._id,
          name: p.name,
          age: p.age,
          gender: p.gender,
          seatId: seatIds[index] || null, // links this passenger to their specific seat
        })),
        { session }
      );

      // Capture the created booking so it's accessible outside withTransaction.
      // withTransaction's callback return value is not exposed — outer variable is the only way.
      booking = createdBooking;
    });

    // Session must be ended regardless of success/failure of withTransaction.
    // withTransaction handles abort internally but does NOT call endSession.
    await session.endSession();

    // ── 7b. Saga Step 1: Hold seats in inventory service ─────────────────
    // Tells inventory to mark these seats as HELD for this booking.
    // Also writes a SagaLog entry (HOLD_SEATS: COMPLETED) — the audit trail
    // that compensateAll reads if something fails later.
    // After this call, booking.status in DB becomes SEATS_HELD.
    await sagaService.executeHoldSeats(
      booking,
      sortedSeatIds,
      config.LOCK_TTL_SECONDS, // how long inventory should hold the seats
      fromSeq,
      toSeq
    );

    // ── 7c. Saga Step 2: Create payment order ─────────────────────────────
    // Calls payment service to create a Payment order.
    // Returns paymentOrder with gatewayOrderId, amount, keyId — everything
    // After this call, booking.status in DB becomes PAYMENT_PENDING.
    // We store the result because we need paymentOrderId in the response.
    const paymentOrder = await sagaService.executeCreatePayment(booking);

    // ── 7d. Refresh booking from DB ───────────────────────────────────────
    // The saga steps updated booking.status via findByIdAndUpdate directly on the DB.
    // Our in-memory `booking` object is stale — it still says status: PENDING.
    // We need the fresh version (PAYMENT_PENDING) for the response.
    // single fetch here, after both saga steps complete.
    const [freshSeats, freshPassengers] = await Promise.all([
      // Promise.all runs both queries in parallel — no reason to wait for seats
      // before starting the passengers query since they're independent.
      BookingSeat.find({ bookingId: booking._id }),
      Passenger.find({ bookingId: booking._id }),
    ]);

    // Refresh the booking document itself to get updated status (PAYMENT_PENDING)
    // and any other fields the saga steps may have written (paymentOrderId).
    booking = await Booking.findById(booking._id).lean();
    // .lean() returns a plain JS object directly — no need to call .toObject() afterwards.
    // Equivalent to toObject() but skips creating a full Mongoose document instance.
    booking.seats = freshSeats;
    booking.passengers = freshPassengers;

    // ── 7e. Build response ─────────────────────────────────────────────────
    // We deliberately shape the response here rather than returning the raw DB
    // document. Reasons: (1) internal fields like version, __v, idempotencyKey
    // should never be exposed to clients. (2) paymentOrder comes from a different
    // source (saga step result) and needs to be merged in. (3) Explicit mapping
    // means adding a new DB field never accidentally leaks to the API.
    const response = {
      bookingId: booking._id,
      status: booking.status,
      totalAmount: booking.totalAmount,
      lockExpiresAt: booking.lockExpiresAt, // client shows countdown: "complete payment in X mins"
      seats: booking.seats.map((s) => ({
        seatId: s.seatId,
        seatNumber: s.seatNumber,
        seatType: s.seatType,
        price: s.price,
      })),
      passengers: booking.passengers.map((p) => ({
        name: p.name,
        age: p.age,
        gender: p.gender,
        // intentionally NOT exposing seatId assignment here — that's internal
      })),
      paymentOrder: {
        paymentOrderId: paymentOrder.paymentOrderId,
        gatewayOrderId: paymentOrder.gatewayOrderId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        keyId: paymentOrder.keyId,
      },
    };

    // ── 7f. Save idempotency record ────────────────────────────────────────
    // Store the response against this key BEFORE returning.
    // If the client retries (step 2 above), they get this exact same response
    // instead of creating a new booking. Saved AFTER success — if we saved
    // before and the saga failed, retries would get a cached success for a
    // booking that actually failed.
    await saveIdempotency(`booking:${idempotencyKey}`, response);

    return response;
  } catch (error) {
    // ─── COMPENSATION: something failed after Redis locks were acquired ─────
    // At this point we might have: a booking record in DB, seats held in inventory,
    // possibly a payment order created. We need to undo whatever succeeded.
    // compensateAll reads SagaLog (COMPLETED steps only, descending order) and
    // reverses each one. If booking doesn't exist yet (DB write itself failed),
    // we skip compensation — there's nothing to undo.

    logger.error(`Booking creation failed for user ${userId}`, {
      error: error.message,
      scheduleId,
      seatIds,
    });

    if (booking) {
      // compensateAll handles: release seats, cancel payment order (if created).
      // Each compensation step is wrapped in its own try/catch — a failed
      // compensation logs a warning but doesn't prevent the others from running.
      await sagaService.compensateAll(booking, sortedSeatIds);

      // Mark the booking as FAILED in DB so the expiry job doesn't try to
      // process it again, and the user sees a clear status on their booking list.
      await Booking.findByIdAndUpdate(booking._id, {
        $set: {
          status: "FAILED",
          // prefer the error message from the downstream service (inventory/payment)
          // over our generic error message — it's more specific.
          failureReason: error.response?.data?.message || error.message,
        },
      });
    }

    // Always release Redis locks — regardless of whether booking exists.
    // If we don't release, these seats are stuck as locked until the TTL expires
    // (could be minutes). lockValue is the token that proves we own these locks —
    // prevents a different process from accidentally releasing locks it doesn't own.
    await releaseSeatLocks(
      scheduleId,
      sortedSeatIds,
      lockValue,
      fromSeq,
      toSeq
    );

    // Re-throw so asyncHandler catches it and errorHandler sends the right HTTP response.
    // We never swallow errors at this layer — compensation is not the same as recovery.
    throw error;
  }
};

// ─── Kafka Consumer Handler: PAYMENT_SUCCESS ─────────────────────────────────
/** 
This function runs inside the Kafka consumer, NOT inside an HTTP request.
There is no asyncHandler/errorHandler safety net catching what this throws.
That single fact shapes almost every decision in this function:
  - "expected, non-error" situations (already confirmed, stale state) → log + return
  - "genuine failure" situations (seat confirm fails) → compensate, then swallow
    (don't re-throw — a thrown error here could crash the consumer or trigger
    Kafka's at-least-once redelivery, reprocessing an event we already handled)
gatewayPaymentId and amount are passed in from the Kafka event payload but are
not used in the core logic below — confirming a booking only needs to know
WHICH booking succeeded (paymentOrderId is the link). They're kept in the
signature for two reasons: (1) future use, e.g. fraud checks comparing `amount`
against booking.totalAmount, and (2) so they're available to persist as part
of the payment audit trail if you choose to store them on the booking record.
*/
const handlePaymentSuccess = async (
  paymentOrderId,
  gatewayPaymentId,
  amount
) => {
  // ── 1. Fetch booking by paymentOrderId ─────────────────────────────────────
  // paymentOrderId is the link between the payment service's event and OUR
  // booking record — it was stored on booking.paymentOrderId back in
  // executeCreatePayment. .lean() because we're only reading here, and we're
  // about to attach plain fields (seats, passengers) that a real Mongoose
  // document wouldn't accept without schema definitions.
  const booking = await Booking.findOne({ paymentOrderId }).lean();

  if (!booking) {
    logger.warn(`No booking found for paymentOrderId: ${paymentOrderId}`);
    return;
  }

  // ── 2. Attach seats and passengers ──────────────────────────────────────────
  // Child-referencing schema (BookingSeat/Passenger store bookingId) means we
  // fetch them separately rather than using populate. Promise.all runs both
  // queries concurrently — they're independent, no reason to wait sequentially.

  const [seats, passengers] = await Promise.all([
    BookingSeat.find({ bookingId: booking._id }),
    Passenger.find({ bookingId: booking._id }),
  ]);

  booking.seats = seats;
  booking.passengers = passengers;

  // ── 3. Idempotency guards ───────────────────────────────────────────────────
  // Kafka delivers messages AT LEAST ONCE — the same PAYMENT_SUCCESS event can
  // arrive twice (consumer restart, rebalance, network retry on the producer
  // side, etc). These checks make this handler safe to run multiple times for
  // the same event without double-confirming a booking or crashing.

  if (booking.status === "CONFIRMED") {
    logger.info(`Booking ${booking._id} already confirmed`);
    return;
  }

  if (booking.status !== "PAYMENT_PENDING") {
    // We only proceed if the booking is EXACTLY in PAYMENT_PENDING. Any other
    // status (SEATS_HELD, CANCELLED, FAILED, EXPIRED, CONFIRMING already in
    // progress from a parallel delivery) means this event arrived at the wrong
    // time or the booking moved on for some other reason. Don't guess — bail
    // safely and let a human/monitoring investigate via the warn log.
    logger.warn(
      `Booking ${booking._id} in unexpected status: ${booking.status}`
    );
    return;
  }

  // Sort seatIds — same deadlock-prevention reasoning as createBooking.
  // We're about to (indirectly) interact with inventory locks again via
  // forceReleaseSeatLocks, so consistent ordering matters here too.
  const seatIds = booking.seats.map((s) => s.seatId).sort();

  try {
    // ── 4. Claim the booking via CAS ─────────────────────────────────────────
    // booking.__v is the version we read in step 1 — a frozen snapshot. If a
    // cancel request or the expiry job already bumped the real version in the
    // DB, this throws StaleStateError and we fall into the catch block below,
    // where the STALE_STATE check makes us bail out cleanly (see comment there).
    await casUpdateBooking(booking._id, booking.__v, { status: "CONFIRMING" });

    // ── 5. Saga Step 3: Confirm seats in inventory ───────────────────────────
    // Tells inventory "the hold on these seats is now permanent — this
    // passenger has a paid ticket." Writes a SagaLog entry (CONFIRM_SEATS:
    // COMPLETED) which is what compensateAll would read if something fails
    // in a LATER step (there isn't one after this, but the pattern stays
    // consistent with the other saga steps for auditability).
    await sagaService.executeConfirmSeats(
      booking,
      seatIds,
      booking.fromSeq,
      booking.toSeq
    );

    // ── 6. Final status transition: CONFIRMING → CONFIRMED ──────────────────
    // We use updateMany with a status guard (not findByIdAndUpdate) for the
    // same defensive reason as the CAS above — even though WE just set it to
    // CONFIRMING two lines ago, this is an extra safety check that nothing
    // else raced in between (in practice unlikely since we hold the "claim",
    // but cheap insurance against bugs we haven't thought of yet).
    // version increments again here — this is now version+2 from where we
    // started (CAS incremented once, this increments again).
    await Booking.updateMany(
      { _id: booking._id, status: "CONFIRMING" },
      {
        $set: { status: "CONFIRMED" },
        $inc: { version: 1 },
      }
    );

    // ── 7. Release Redis locks ───────────────────────────────────────────────
    // forceReleaseSeatLocks (vs the regular release) doesn't require the
    // original lockValue token — appropriate here because this code runs in
    // a totally different process (Kafka consumer) than the one that acquired
    // the lock (the HTTP request handler in createBooking). We don't have
    // that original token in this context, so we force-release by booking
    // identity instead.
    await forceReleaseSeatLocks(
      booking.scheduleId,
      seatIds,
      booking.fromSeq,
      booking.toSeq
    );

    // ── 8. Publish BOOKING_CONFIRMED — non-critical side effect ─────────────
    // Deliberately wrapped in its OWN try/catch, separate from the outer one.
    // Why: the booking is ALREADY confirmed and paid for by this point — that
    // is the source of truth. If the notification/search-indexing event fails
    // to publish, that should NEVER cause us to compensate (refund!) a
    // successful booking. This inner try/catch isolates a non-critical
    // failure from triggering the critical failure path below.
    try {
      const [userInfo, fromStationName, toStationName] = await Promise.all([
        fetchUserForNotification(booking.userId),
        fetchStationName(booking.fromStationId),
        fetchStationName(booking.toStationId),
      ]);

      await bookingProducer.publishBookingConfirmed({
        bookingId: booking._id,
        userId: booking.userId,
        email: userInfo.email,
        firstName: userInfo.firstName,
        scheduleId: booking.scheduleId,
        trainNumber: booking.trainNumber,
        trainName: booking.trainName,
        fromStationName,
        toStationName,
        departureDate: booking.departureDate,
        seats: booking.seats.map((s) => ({
          seatNumber: s.seatNumber,
          seatType: s.seatType,
          price: s.price,
        })),
        passengers: booking.passengers.map((p) => ({
          name: p.name,
          age: p.age,
          gender: p.gender,
        })),
        totalAmount: booking.totalAmount,
      });
    } catch (error) {
      logger.error(
        "CRITICAL: Failed to publish BOOKING_CONFIRMED after retries — notification/search may be stale",
        {
          bookingId: booking._id,
          error: error.message,
        }
      );
      // Deliberately no re-throw — see comment above the try. A failed
      // notification must never undo a successful, paid booking.
    }

    logger.info(`Booking ${booking._id} confirmed successfully`);
  } catch (error) {
    // ── STALE STATE: another process already handled this booking ──────────
    // This is the expected outcome of the race condition we discussed earlier
    // (payment success vs. cancel arriving simultaneously). If we lost that
    // race, the booking has already been moved to CANCELLING/CANCELLED/EXPIRED
    // by whoever won. There is nothing for us to do — re-running compensation
    // here would be WRONG, since the winning process is responsible for its
    // own cleanup. We just log and exit quietly.
    if (error.code === "STALE_STATE") {
      logger.info(
        `Booking ${booking._id} already handled by another process, skipping`
      );
      return;
    }

    // ── GENUINE FAILURE: something broke during confirm (not a race) ───────
    // This branch only runs for real failures — e.g. executeConfirmSeats threw
    // because the inventory service was down, or returned an unexpected error.
    // At this point we've already paid (payment succeeded — that's why we're
    // in this function at all) but couldn't finish confirming the seats. We
    // must undo what we can and refund the user — this is NOT a state we can
    // leave hanging.
    logger.error(`Failed to confirm booking ${booking._id}`, {
      error: error.message,
    });

    // compensateAll walks completed SagaLog steps in reverse and undoes them.
    // At this point HOLD_SEATS and CREATE_PAYMENT are COMPLETED (we got this
    // far only because payment succeeded), so this will: cancel/refund the
    // payment, then release the held seats. CONFIRM_SEATS itself failed, so
    // there's nothing to compensate for that step specifically.
    await sagaService.compensateAll(booking, seatIds);

    // NOT interpret a bare array as "matches any of these." You need the
    // explicit $in operator to express "status is currently PAYMENT_PENDING
    // OR CONFIRMING" — without $in, this filter would try to match status
    // against the array itself (which would never match a string field) and
    // silently update zero documents.
    await Booking.updateMany(
      { _id: booking._id, status: { $in: ["PAYMENT_PENDING", "CONFIRMING"] } },
      {
        $set: {
          status: "FAILED",
          failureReason: `confirm_failed: ${error.message}`,
        },
        $inc: { version: 1 },
      }
    );

    await forceReleaseSeatLocks(
      booking.scheduleId,
      seatIds,
      booking.fromSeq,
      booking.toSeq
    );

    // Same isolation pattern as step 8 — a failed BOOKING_FAILED notification
    // must not throw out of this catch block and crash the consumer. The
    // booking's own state (FAILED) is already correctly persisted above
    // regardless of whether this notification succeeds.
    try {
      const userInfo = await fetchUserForNotification(booking.userId);
      await bookingProducer.publishBookingFailed({
        bookingId: booking._id,
        userId: booking.userId,
        email: userInfo.email,
        firstName: userInfo.firstName,
        scheduleId: booking.scheduleId,
        reason: "confirm_seats_failed",
      });
    } catch (err) {
      logger.error("Failed to publish BOOKING_FAILED after retries", {
        bookingId: booking._id,
        error: err.message,
      });
    }

    // Deliberately NO re-throw at the end of this outer catch. Unlike
    // createBooking (which runs in an HTTP request and re-throws so
    // asyncHandler/errorHandler can respond to the client), this function has
    // no caller waiting for a response. Throwing here would only risk
    // crashing the Kafka consumer or triggering a redelivery of an event
    // we've already fully handled (compensated + marked FAILED). The
    // function's job is done: log it, fix the state, move on.
  }
};

// ─── Handle Payment Failure (Kafka consumer) ─────────────────────────────────

const handlePaymentFailure = async (paymentOrderId, reason) => {
  const booking = await Booking.findOne({ paymentOrderId }).lean();

  if (!booking) {
    // No matching booking — nothing to do, log for visibility
    logger.warn(`No booking found for paymentOrderId: ${paymentOrderId}`);
    return;
  }

  if (
    booking.status === "CANCELLED" ||
    booking.status === "EXPIRED" ||
    booking.status === "FAILED"
  ) {
    // Already terminal — idempotent no-op for Kafka redelivery
    logger.info(`Booking ${booking._id} already in terminal state: ${booking.status}`);
    return;
  }

  if (booking.status !== "PAYMENT_PENDING") {
    // Booking moved to some other state we don't expect here — bail safely
    logger.warn(`Booking ${booking._id} in unexpected status: ${booking.status}`);
    return;
  }

  // fetch seats separately (child-referencing schema) and attach to booking
  const seats = await BookingSeat.find({ bookingId: booking._id });
  booking.seats = seats;

  const seatIds = booking.seats.map((s) => s.seatId).sort();

  try {
    // claim this booking before compensating — protects against a race with
    // cancelBooking or the expiry job touching the same booking concurrently
    await casUpdateBooking(booking._id, booking.__v, {
      status: "FAILED",
      failureReason: reason || "payment_failed",
    });
  } catch (error) {
    if (error.code === "STALE_STATE") {
      // someone else already handled this booking — nothing more to do
      logger.info(`Booking ${booking._id} already handled by another process, skipping`);
      return;
    }
    // genuine unexpected error — let it propagate, no compensation state to clean up yet
    throw error;
  }

  // undo the seat hold — payment never succeeded, so nothing to refund
  await sagaService.compensateHoldSeats(booking, seatIds);

  // release the Redis locks for these seats
  await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

  try {
    // notify the user — isolated try/catch, must not undo the FAILED status above
    const userInfo = await fetchUserForNotification(booking.userId);
    await bookingProducer.publishBookingFailed({
      bookingId: booking._id,
      userId: booking.userId,
      email: userInfo.email,
      firstName: userInfo.firstName,
      scheduleId: booking.scheduleId,
      reason: reason || "payment_failed",
    });
  } catch (err) {
    logger.error("Failed to publish BOOKING_FAILED after retries", {
      bookingId: booking._id,
      error: err.message,
    });
  }

  logger.info(`Booking ${booking._id} failed: ${reason}`);
};

// ─── Cancel Booking ──────────────────────────────────────────────────────────

const cancelBooking = async (bookingId, userId) => {

  const booking = await Booking.findById(bookingId).lean();

  if (!booking) {
    throw new NotFoundError(`Booking not found for bookingId ${bookingId}`);
  }

  if (booking.userId !== userId) {
    // deliberately the same NotFoundError as "doesn't exist" — don't leak
    // that this booking exists but belongs to someone else
    throw new NotFoundError(`Booking not found for userId ${userId}`);
  }

  if (
    ["CANCELLED", "CANCELLING", "FAILED", "EXPIRED", "CONFIRMING"].includes(booking.status)
  ) {
    // can't cancel something already terminal or already mid-transition
    throw new ConflictError(`Booking is already ${booking.status}`);
  }

  const seats = await BookingSeat.find({ bookingId });
  booking.seats = seats;

  const seatIds = booking.seats.map((s) => s.seatId).sort();

  let refundInitiated = false;

  try {
    // claim ownership before touching anything external — prevents racing
    // with a payment webhook or the expiry job hitting this same booking
    await casUpdateBooking(bookingId, booking.__v, {
      status: "CANCELLING",
      failureReason: "user_cancelled",
    });
  } catch (error) {
    if (error.code === "STALE_STATE") {
      // give the user an accurate picture of what actually happened
      const fresh = await Booking.findById(bookingId).lean();
      throw new ConflictError(
        `Booking status changed to ${fresh?.status || "unknown"} while cancelling. Please refresh.`
      );
    }
    throw error;
  }

  if (booking.status === "CONFIRMED") {
    // confirmed booking — must release seats in inventory before refunding
    try {
      await inventoryClient.cancelBooking(booking.scheduleId, bookingId, userId);
    } catch (error) {
      logger.error(`Failed to release seats in inventory for booking ${booking._id}`, {
        error: error.message,
      });

      // inventory call failed — roll back our CANCELLING claim so the user can retry
      await Booking.updateMany(
        { _id: bookingId, userId, status: "CANCELLING" },
        {
          $set: { status: "CONFIRMED", failureReason: null },
          $inc: { version: 1 },
        }
      );
      throw error;
    }

    if (booking.paymentOrderId) {
      try {
        const idempotencyKey = `${booking._id}-cancel-refund`;
        await paymentClient.initiateRefund(
          booking.paymentOrderId,
          booking.totalAmount,
          "user_cancelled",
          idempotencyKey
        );
        refundInitiated = true;
      } catch (error) {
        // refund failure doesn't block the cancellation itself — log and move on
        logger.error(`Failed to initiate refund for booking ${booking._id}`, {
          error: error.message,
        });
      }
    }
  } else if (["PAYMENT_PENDING", "SEATS_HELD"].includes(booking.status)) {
    // not yet confirmed — just release the held seats, nothing to refund
    try {
      await inventoryClient.releaseSeats(
        booking.scheduleId,
        seatIds,
        booking.userId,
        booking.fromSeq,
        booking.toSeq
      );
    } catch (error) {
      logger.error(`Failed to release seats during cancel`, { error: error.message });
    }
  }

  // final transition — CANCELLING is now confirmed complete
  await Booking.updateMany(
    { _id: bookingId, status: "CANCELLING" },
    { $set: { status: "CANCELLED" }, $inc: { version: 1 } }
  );

  await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

  try {
    // notification — isolated, must not undo the cancellation above
    const userInfo = await fetchUserForNotification(booking.userId);
    await bookingProducer.publishBookingCancelled({
      bookingId: booking._id,
      userId: booking.userId,
      email: userInfo.email,
      firstName: userInfo.firstName,
      scheduleId: booking.scheduleId,
      reason: "user_cancelled",
      refundAmount: refundInitiated ? booking.totalAmount : 0,
    });
  } catch (err) {
    logger.error("Failed to publish BOOKING_CANCELLED after retries", {
      bookingId: booking._id,
      error: err.message,
    });
  }

  logger.info(`Booking ${booking._id} cancelled by user ${userId}`);

  return {
    bookingId: booking._id,
    status: "CANCELLED",
    refundInitiated,
  };
};

// ─── Get Booking ─────────────────────────────────────────────────────────────

const getBooking = async (bookingId, userId) => {

  const booking = await Booking.findOne({ _id: bookingId }).lean();

  if (!booking || booking.userId !== userId) {
    // same NotFoundError for both cases — don't leak existence to non-owners
    throw new NotFoundError("Booking not found");
  }

  //.sort("asc") isn't valid Mongoose syntax — needs a field name,
  // not the direction alone. { seatNumber: 1 } is the correct ascending sort.
  const [seats, passengers] = await Promise.all([
    BookingSeat.find({ bookingId }).sort({ seatNumber: 1 }),
    Passenger.find({ bookingId }),
  ]);

  booking.seats = seats;
  booking.passengers = passengers;

  return {
    id: booking._id,
    status: booking.status,
    scheduleId: booking.scheduleId,
    trainId: booking.trainId,
    trainNumber: booking.trainNumber,
    trainName: booking.trainName,
    departureDate: booking.departureDate,
    totalAmount: booking.totalAmount,
    seatCount: booking.seatCount,
    fromStationId: booking.fromStationId,
    toStationId: booking.toStationId,
    fromSeq: booking.fromSeq,
    toSeq: booking.toSeq,
    paymentOrderId: booking.paymentOrderId,
    lockExpiresAt: booking.lockExpiresAt,
    failureReason: booking.failureReason,
    seats: booking.seats.map((s) => ({
      seatId: s.seatId,
      seatNumber: s.seatNumber,
      seatType: s.seatType,
      price: s.price,
    })),
    passengers: booking.passengers.map((p) => ({
      id: p._id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      seatId: p.seatId,
    })),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
};

// ─── Get User Bookings (paginated list) ──────────────────────────────────────
// Returns a page of a user's bookings, newest first, with optional status filter.
//
// PAGINATION EXPLAINED FROM SCRATCH:
// The client asks for "page 2, 10 per page" — they don't want all 500 of a
// user's bookings sent over the wire at once. We need to translate
// (page, limit) into a MongoDB skip/limit pair.
//
//   page=1, limit=10  → show bookings  1-10   → skip 0,  take 10
//   page=2, limit=10  → show bookings 11-20   → skip 10, take 10
//   page=3, limit=10  → show bookings 21-30   → skip 20, take 10
//
// The formula is: skip = (page - 1) * limit
//   page 1: (1-1)*10 = 0   — skip nothing, start from the beginning
//   page 2: (2-1)*10 = 10  — skip the first 10, start from #11
//   page 3: (3-1)*10 = 20  — skip the first 20, start from #21
//
// "skip" tells MongoDB how many matching documents to jump over before it
// starts collecting results. "limit" (called "take" in Prisma, ".limit()" in
// Mongoose) tells it to stop after collecting that many.
//
// We ALSO need the TOTAL count of matching bookings (regardless of page) so
// the client can render "Page 2 of 14" or disable the "Next" button on the
// last page. That's a SEPARATE query — Mongo's find() with skip/limit only
// returns the current page's documents, it has no idea how many total
// documents exist beyond what it fetched. So we run two independent queries:
// one for "give me this page's data," one for "tell me the total count."
// We fire them both with Promise.all so they run concurrently rather than
// one waiting for the other — they don't depend on each other's results.

const getUserBookings = async (userId, { status, page = 1, limit = 10 } = {}) => {
  // destructuring with a default: if the caller passes NOTHING as the second
  // argument, `{} = {}` falls back to an empty object, which itself falls
  // back to page=1, limit=10 individually. Prevents a crash if called as
  // getUserBookings(userId) with no options object at all.

  const skip = (page - 1) * limit;
  // the core pagination math explained above — how many documents to skip
  // before collecting this page's results

  const filter = { userId };
  // base filter: always scoped to this user — a user must never see another
  // user's bookings regardless of what other filters are applied

  if (status) {
    // optional status filter — only added to the query if the caller actually
    // passed one. toUpperCase() normalizes "confirmed" or "Confirmed" from the
    // client into "CONFIRMED" to match our enum values exactly — enum
    // comparisons in MongoDB are case-sensitive strings, so this guards
    // against a client sending lowercase and getting zero results back.
    filter.status = status.toUpperCase();
  }

  // run both queries concurrently: page of bookings + total count.
  // These are independent — the count doesn't need the bookings, and the
  // bookings don't need the count. Running them in parallel instead of
  // sequentially roughly halves the wait time for this function.
  const [bookings, total] = await Promise.all([
    // query 1: fetch THIS PAGE of bookings, with seats sorted by seat number
    // and ALL passengers attached. .sort({ createdAt: -1 }) means newest
    // bookings appear first — the most common UX expectation for a list of
    // past orders/bookings.
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)     // jump over the previous pages' worth of documents
      .limit(limit)   // stop after collecting this page's worth
      .lean(),

    // query 2: count ALL documents matching `filter`, ignoring skip/limit
    // entirely. This tells us how many bookings exist in total across every
    // page — needed to compute totalPages below. Note: countDocuments must
    // receive the SAME filter as the find() above, or the total would be
    // wrong relative to what's actually being paginated (e.g. counting ALL
    // bookings when the user only asked for CONFIRMED ones).
    Booking.countDocuments(filter),
  ]);

  // for each booking on this page, we still need its seats and passengers —
  // child-referencing schema means these aren't embedded, so we fetch them
  // per booking. Promise.all here runs all these lookups concurrently across
  // every booking in the current page (not sequentially, one booking at a time).
  const bookingsWithDetails = await Promise.all(
    bookings.map(async (b) => {
      const [seats, passengers] = await Promise.all([
        BookingSeat.find({ bookingId: b._id }).sort({ seatNumber: 1 }),
        Passenger.find({ bookingId: b._id }),
      ]);
      return { ...b, seats, passengers };
      // spread the original booking fields, then overwrite/add seats and
      // passengers — same pattern as the segmentStatus spread you saw earlier
      // in the inventory service
    })
  );

  return {
    bookings: bookingsWithDetails.map((b) => ({
      id: b._id,
      status: b.status,
      scheduleId: b.scheduleId,
      trainNumber: b.trainNumber,
      trainName: b.trainName,
      departureDate: b.departureDate,
      totalAmount: b.totalAmount,
      seatCount: b.seatCount,
      fromStationId: b.fromStationId,
      toStationId: b.toStationId,
      fromSeq: b.fromSeq,
      toSeq: b.toSeq,
      seats: b.seats.map((s) => ({
        seatId: s.seatId,
        seatNumber: s.seatNumber,
        seatType: s.seatType,
        price: s.price,
      })),
      passengers: b.passengers.map((p) => ({
        name: p.name,
        age: p.age,
        gender: p.gender,
      })),
      createdAt: b.createdAt,
    })),
    pagination: {
      page,    // echo back what page the client asked for
      limit,   // echo back the page size used
      total,   // total matching bookings across ALL pages combined
      totalPages: Math.ceil(total / limit),
      // Math.ceil rounds UP — if total=25 and limit=10, that's 2.5 pages,
      // which must round up to 3 (page 3 holds the remaining 5 bookings).
      // Rounding down would silently hide the last partial page of results.
    },
  };
};

// ─── Verify Payment (client-side verification after Safepay checkout) ───────

const verifyPayment = async (bookingId, userId, safepayPaymentId, safepaySignature) => {
  const booking = await Booking.findOne({ _id: bookingId }).lean();

  if (!booking || booking.userId !== userId) {
    throw new NotFoundError("Booking not found");
  }

  if (!booking.paymentOrderId) {
    throw new BadRequestError("Booking has no payment order");
  }

  if (booking.status === "CONFIRMED") {
    return { bookingId: booking._id, status: "CONFIRMED", message: "Already confirmed" };
  }

  if (booking.status !== "PAYMENT_PENDING") {
    throw new ConflictError(`Booking is in ${booking.status} status, cannot verify payment`);
  }

  const result = await paymentClient.verifyPayment(
    booking.paymentOrderId,
    safepayPaymentId,
    safepaySignature
  );

  logger.info(`Payment verified for booking ${bookingId}`, { result });

  return {
    bookingId: booking._id,
    paymentStatus: result.status,
  };
};

// ─── Handle Schedule Cancelled (Kafka consumer) ─────────────────────────────
// Fired when the SCHEDULE itself is cancelled by an admin (e.g. train
// breakdown, route suspension) — NOT a user-initiated cancellation. This must
// sweep through EVERY active booking on that schedule and cancel each one,
// refunding anyone who'd already paid. This is a bulk operation over
// potentially many bookings, so the structure looks different from the
// single-booking functions above: a fetch-many, then a for-loop that handles
// each booking independently, with its own try/catch PER booking so one
// failure doesn't stop the rest from being processed.

const handleScheduleCancelled = async (scheduleId) => {
  if (!scheduleId) {
    // defensive guard — this function is triggered by a Kafka event payload;
    // if the event is malformed and scheduleId is missing, we can't safely
    // query anything. Log loudly and exit rather than running a query with
    // an undefined filter (which could match far more than intended).
    logger.warn("handleScheduleCancelled called without scheduleId");
    return;
  }

  // We fetch every booking on this schedule that is currently in an "active"
  // state — meaning it hasn't already reached a terminal state. A booking
  // that's already CANCELLED, FAILED, or EXPIRED doesn't need to be touched —
  // it's already resolved, one way or another.
  const activeBookings = await Booking.find({
    scheduleId,
    status: { $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING", "CONFIRMED"] },
  }).lean();

  if (activeBookings.length === 0) {
    // nothing to do — every booking on this schedule was already resolved
    // before the cancellation event arrived (rare, but possible if the admin
    // cancels a schedule that had no real bookings, or all bookings already
    // expired naturally)
    logger.info(`No active bookings to cancel for schedule ${scheduleId}`);
    return;
  }

  logger.info(
    `Cancelling ${activeBookings.length} active booking(s) due to schedule cancellation`,
    { scheduleId }
  );

  // Process each booking ONE AT A TIME (sequential for...of, not
  // Promise.all/parallel). This is deliberate: each booking involves its own
  // external calls (refund, lock release, notification) and we want full
  // try/catch isolation per booking — if booking #3 out of 50 throws an
  // unexpected error, we log it and continue to #4 rather than the entire
  // batch failing because of one bad booking. Running these in parallel
  // would also hammer the payment/inventory services with a burst of
  // simultaneous calls, which the sequential approach naturally throttles.
  for (const booking of activeBookings) {
    try {
      // CAS claim: WHY this matters here specifically — between the moment
      // we fetched `activeBookings` above and the moment we get to THIS
      // particular booking in the loop, time has passed. It's possible the
      // user cancelled this exact booking themselves, or the expiry job
      // already touched it, in the gap between our fetch and now. The
      // version check catches that: if someone else already moved this
      // booking's status, our update matches zero documents and we skip it
      // rather than double-cancelling or overwriting a different terminal state.
      const claimed = await Booking.updateMany(
        {
          _id: booking._id,
          version: booking.version,
          // re-check status is STILL one of the active states — guards
          // against the exact race condition described above
          status: { $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING", "CONFIRMED"] },
        },
        {
          $set: { status: "CANCELLED", failureReason: "schedule_cancelled" },
          $inc: { version: 1 },
        }
      );


      if (claimed.matchedCount === 0) {
        // someone else already handled this booking between our fetch and
        // now — don't process it again, move to the next booking in the loop
        logger.info(`Booking ${booking._id} already handled, skipping schedule-cancel`);
        continue;
        // `continue` skips the rest of THIS iteration only — the for loop
        // moves on to the next booking. It does not exit the loop entirely.
      }

      // fetch this specific booking's seats — needed to release Redis locks below
      const seats = await BookingSeat.find({ bookingId: booking._id });
      const seatIds = seats.map((s) => s.seatId).sort();

      // release any Redis locks still held for these seats — this is a
      // "force" release (no token needed) because, like the Kafka payment
      // handlers, this code runs in a consumer process that never held the
      // original lock token to begin with
      await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

      // only CONFIRMED bookings with an actual payment need a refund — a
      // booking still in PENDING/SEATS_HELD/PAYMENT_PENDING never completed
      // payment, so there's nothing to give back
      if (booking.status === "CONFIRMED" && booking.paymentOrderId) {
        try {
          const idempotencyKey = `${booking._id}-schedule-cancel-refund`;
          await paymentClient.initiateRefund(
            booking.paymentOrderId,
            booking.totalAmount,
            "schedule_cancelled",
            idempotencyKey
          );
        } catch (refundErr) {
          // refund failure shouldn't stop us from finishing this booking's
          // cancellation — log it for manual follow-up, keep going
          logger.error(
            `Failed to initiate refund for booking ${booking._id} during schedule cancellation`,
            { error: refundErr.message }
          );
        }
      }

      try {
        // notify the affected user — isolated try/catch, must not undo the
        // cancellation that already happened above
        const userInfo = await fetchUserForNotification(booking.userId);
        await bookingProducer.publishBookingCancelled({
          bookingId: booking._id,
          userId: booking.userId,
          email: userInfo.email,
          firstName: userInfo.firstName,
          scheduleId: booking.scheduleId,
          reason: "schedule_cancelled",
          refundAmount: booking.status === "CONFIRMED" ? booking.totalAmount : 0,
        });
      } catch (err) {
        logger.error("Failed to publish BOOKING_CANCELLED for schedule cancellation", {
          bookingId: booking._id,
          error: err.message,
        });
      }

      logger.info(`Booking ${booking._id} cancelled due to schedule cancellation`);

    } catch (error) {
      // THIS is the outer safety net for the entire per-booking iteration.
      // If anything unexpected throws anywhere above for THIS booking (not
      // already caught by an inner try/catch), we log it and the for loop
      // continues to the next booking automatically — a for...of loop only
      // stops early if you explicitly break or if an uncaught error escapes
      // the loop body entirely. This try/catch is what prevents one bad
      // booking from halting the cancellation of the other 49.
      logger.error(`Failed to cancel booking ${booking._id} during schedule cancellation`, {
        error: error.message,
      });
    }
  }
};

export const bookingService = {
  createBooking,
  handlePaymentSuccess,
  handlePaymentFailure,
  cancelBooking,
  getBooking,
  getUserBookings,
  verifyPayment,
  handleScheduleCancelled
};
