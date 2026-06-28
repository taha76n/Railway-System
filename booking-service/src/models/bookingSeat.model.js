// all imports must be at the top — missing any of these causes ReferenceError at runtime
import { logger } from "../configs/logger.js";
import { redis } from "../configs/redis.js";
import { config } from "../configs/index.js";
import Booking from "../models/booking.model.js";
import BookingSeat from "../models/bookingSeat.model.js";
import { sagaService } from "../services/saga.service.js";
import { forceReleaseSeatLocks } from "../utils/distributedLock.js";
import { bookingProducer } from "../kafka/producer/booking.producer.js";
import { userClient } from "../services/userClient.js";

// helper to fetch user email and name for the BOOKING_FAILED notification
// isolated try/catch — if user service is down, we still expire the booking
// we just send the notification with empty user details rather than crashing
const fetchUserForNotification = async (userId) => {
  try {
    const user = await userClient.getUserById(userId);
    // if user exists return only what the notification needs, nothing else
    return user ? { email: user.email, firstName: user.firstName } : {};
  } catch (error) {
    // non-critical — log as warn not error, expiry job must continue regardless
    logger.warn(`Failed to enrich expiry event with user details`, {
      userId,
      error: error.message,
    });
    return {};
  }
};

// module-level variable so stopBookingExpiryJob can clear the interval later
// null means no job is currently running
let expiryInterval = null;

// the Redis key used for leader election — one key shared across ALL replicas
// whichever instance sets this key first in a given cycle becomes the leader
const LEADER_KEY = `booking:expiry-job:leader`;

// 25 seconds — shorter than the 30s job interval on purpose
// guarantees the key expires BEFORE the next cycle fires, so a new leader
// can always be elected cleanly (see explanation in comments on tryAcquireLeadership)
const LEADER_TTL_SECONDS = 25;

// tries to become the leader for this expiry cycle using Redis SET NX EX
// NX = only set if the key does NOT already exist
// EX = auto-expire after LEADER_TTL_SECONDS
// returns true if THIS instance won leadership, false if another instance already holds it
const tryAcquireLeadership = async () => {
  try {
    // process.pid is this Node process's unique ID — stored as the lock value
    // so if you ever need to debug "which replica is leader", redis.get(LEADER_KEY) tells you
    const result = await redis.set(
      LEADER_KEY,
      process.pid.toString(),
      "NX",
      "EX",
      LEADER_TTL_SECONDS
    );
    // Redis returns "OK" if the key was set (we won), null if it already existed (we lost)
    return result === "OK";
  } catch (error) {
    // Redis itself is unreachable — safer to skip this cycle than to have ALL
    // instances run simultaneously just because the election mechanism failed
    logger.error(`Failed to acquire expiry job leadership`, {
      error: error.message,
    });
    return false;
  }
};

const cleanExpiredBookings = async () => {
  // only ONE instance across all replicas should run per cycle
  // the others detect they lost the election here and return immediately
  const isLeader = await tryAcquireLeadership();
  if (!isLeader) {
    logger.debug(`Skipping expiry job — another instance is the leader`);
    return;
  }

  try {
    // find all bookings that:
    // 1. are still in an active (non-terminal) state
    // 2. whose lockExpiresAt timestamp is in the past
    // this query uses the compound index { lockExpiresAt: 1, status: 1 } defined
    // on your booking schema — without that index this would be a full collection
    // scan on every 30-second cycle, which would destroy DB performance at scale
    // .lean() returns plain JS objects — faster, and we need to attach .seats below
    const expiredBookings = await Booking.find({
      status: { $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING"] },
      // new Date() with parentheses creates a Date instance representing right now
      // new Date without () passes the constructor function itself — MongoDB can't use that
      lockExpiresAt: { $lt: new Date() },
    }).lean();

    // early exit — nothing to do this cycle, avoids unnecessary log noise
    if (expiredBookings.length === 0) {
      return;
    }

    logger.info(`Found ${expiredBookings.length} expired booking(s) to clean up`);

    // process each expired booking independently — one failure must not stop the others
    // this is the same for...of pattern used in handleScheduleCancelled
    for (const booking of expiredBookings) {
      try {
        // fetch this specific booking's seats inside the loop, not outside
        // outside the loop `booking` doesn't exist as a variable yet — ReferenceError
        // each booking needs its OWN seats, not one shared fetch for all bookings
        const seats = await BookingSeat.find({ bookingId: booking._id });
        // attach seats to the booking object so compensateAll and forceReleaseSeatLocks
        // can access them — same pattern used in handleScheduleCancelled and handlePaymentFailure
        booking.seats = seats;

        // map to seatId strings — these are what inventory service and Redis lock keys use
        // .sort() for consistent lock ordering (deadlock prevention — same reason as createBooking)
        // arrow function WITHOUT curly braces — implicit return of s.seatId
        // with curly braces you need an explicit return, otherwise you get undefined for every element
        const seatIds = booking.seats.map((s) => s.seatId).sort();

        // CAS claim — atomically mark this booking as EXPIRED only if:
        // 1. the _id matches (targeting the right document)
        // 2. version matches the snapshot we read above (nobody else changed it since)
        // 3. status is still one of the active states (extra guard against concurrent handlers)
        // if a payment webhook or user cancel already moved this booking, matchedCount = 0 and we skip
        const claimed = await Booking.updateMany(
          {
            _id: booking._id,
            // using booking.version (your explicit schema field) not booking.__v
            // be consistent with whichever field casUpdateBooking uses across the whole codebase
            version: booking.version,
            status: { $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING"] },
          },
          {
            $set: {
              status: "EXPIRED",
              failureReason: "booking_timeout",
            },
            // increment version so any concurrent process reading the old version
            // will find matchedCount = 0 and correctly back off
            $inc: { version: 1 },
          }
        );

        // matchedCount = 0 means another process (payment webhook, cancel handler)
        // already changed this booking's version or status between our find() and now
        // continue skips the rest of THIS iteration only, the loop carries on with the next booking
        if (claimed.matchedCount === 0) {
          logger.info(
            `Booking ${booking._id} already handled by another process, skipping expiry`
          );
          continue;
        }

        // walk the SagaLog in reverse order and undo each completed step
        // HOLD_SEATS → release inventory hold
        // CREATE_PAYMENT → initiate refund (if payment order was created)
        // compensateAll is wrapped in try/catch internally per step — one failed
        // compensation step won't prevent the others from running
        await sagaService.compensateAll(booking, seatIds);

        // release any Redis seat locks still held for these seats
        // forceReleaseSeatLocks doesn't need the original lockValue token —
        // the expiry job runs in a different process than the one that acquired the lock
        await forceReleaseSeatLocks(
          booking.scheduleId,
          seatIds,
          booking.fromSeq,
          booking.toSeq
        );

        // notify the user their booking expired — isolated in its own try/catch
        // a failed notification must never prevent the expiry from being recorded
        // the booking's EXPIRED status in DB is already the source of truth at this point
        try {
          const userInfo = await fetchUserForNotification(booking.userId);
          await bookingProducer.publishBookingFailed({
            // after .lean(), Mongoose documents don't have the .id virtual getter
            // must use ._id directly
            bookingId: booking._id,
            userId: booking.userId,
            email: userInfo.email,
            firstName: userInfo.firstName,
            scheduleId: booking.scheduleId,
            reason: "booking_timeout",
          });
        } catch (err) {
          logger.error("Failed to publish BOOKING_FAILED for expired booking", {
            bookingId: booking._id,
            error: err.message,
          });
        }

        logger.info(`Expired booking ${booking._id} cleaned up`, {
          // previousStatus from the snapshot — useful for debugging which state it was stuck in
          previousStatus: booking.status,
        });

      } catch (error) {
        // outer catch for this booking iteration — handles anything not caught above
        // logs and moves on so the remaining bookings in this cycle still get processed
        logger.error(`Failed to clean up expired booking ${booking._id}`, {
          error: error.message,
        });
      }
    }
  } catch (error) {
    // outer catch for the entire job run — handles DB connection failures,
    // unexpected errors in the find() query, or anything that escaped the per-booking catch
    logger.error("Error in booking expiry job", { error: error.message });
  }
};

// called once during service startup from index.js
const startBookingExpiryJob = () => {
  // run once immediately so expired bookings from before restart are cleaned right away
  // without this, you'd wait a full 30 seconds before the first run
  cleanExpiredBookings();

  // then repeat on the configured interval (default 30000ms = 30 seconds)
  // setInterval returns a Timeout object — stored in expiryInterval so we can cancel it
  expiryInterval = setInterval(
    cleanExpiredBookings,
    config.BOOKING_EXPIRY_CHECK_INTERVAL_MS
  );

  logger.info(
    `Booking expiry job started (interval: ${config.BOOKING_EXPIRY_CHECK_INTERVAL_MS}ms)`
  );
};

// called during graceful shutdown (SIGTERM/SIGINT handler in index.js)
// stops the repeating timer so Node doesn't try to run the job during shutdown
const stopBookingExpiryJob = () => {
  if (expiryInterval) {
    // clearInterval cancels the repeating timer started by setInterval
    clearInterval(expiryInterval);
    // null it out so if stopBookingExpiryJob is accidentally called twice, the
    // if check above prevents a second clearInterval call on an already-cleared timer
    expiryInterval = null;
    logger.info("Booking expiry job stopped");
  }
};

export { startBookingExpiryJob, stopBookingExpiryJob };