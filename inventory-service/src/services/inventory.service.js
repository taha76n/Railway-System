import mongoose from "mongoose";
import { logger } from "../configs/logger.js";
import { IdempotencyRecord } from "../models/idempotencyRecord.model.js";
import { ScheduleInventory } from "../models/scheduleInventory.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { SeatInventory } from "../models/seatInventory.model.js";
import { RouteStop } from "../models/routeStop.model.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/error.js";
import { config } from "../configs/index.js";
import { SeatSegmentLock } from "../models/seatSegmentLock.model.js";
import { retryTransaction } from "../utils/retryTransaction.js";

const initializeInventory = asyncHandler(async (eventData) => {
  const { scheduleId, trainId, trainNumber, trainName, departureDate, seats } =
    eventData;

  if (!scheduleId || !seats || seats.length === 0) {
    logger.warn(
      `Invalid SCHEDULE_CREATED event - scheduleId or seats are missing`
    );
    return;
  }

  const eventKey = `SCHEDULE_CREATED:${scheduleId}`;

  const isDuplicate = await IdempotencyRecord.findOne({ eventKey });

  if (isDuplicate) {
    logger.info(`Duplicate event is skipped ${eventKey}`);
    return;
  }

  const totalSeats = seats.length;

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const schedule = await ScheduleInventory.create(
        [
          {
            scheduleId,
            trainId,
            trainNumber,
            trainName,
            departureDate: new Date(departureDate),
            totalSeats,
            available: totalSeats,
            locked: 0,
            booked: 0,
            status: "ACTIVE",
          },
        ],
        { session }
      );

      const seatData = seats.map((seat) => ({
        scheduleInventoryId: schedule[0]._id,
        scheduleId,
        seatId: seat.seatId,
        seatNumber: seat.seatNumber,
        seatType: seat.seatType,
        price: seat.price,
        status: "AVAILABLE",
      }));

      await SeatInventory.insertMany(seatData, { session });

      // --- SEGMENT BOOKING: Persist route topology for segment overlap checks ---
      if (eventData.route && eventData.route.length > 0) {
        const routeStopData = eventData.route.map((rs) => ({
          scheduleId,
          stationId: rs.stationId,
          stationName: rs.stationName,
          stationCode: rs.stationCode,
          sequenceNumber: rs.sequenceNumber,
        }));
        await RouteStop.insertMany(routeStopData, { session });
        logger.info(
          `Persisted ${routeStopData.length} route stops for schedule ${scheduleId}`
        );
      }

      await IdempotencyRecord.create({ eventKey }, { session });
    });
  } catch (error) {
    logger.error(`Transaction Failed: ${error}`);
  } finally {
    await session.endSession();
  }

  logger.info(
    `Inventory initialized for schedule ${scheduleId} with ${totalSeats} seats`
  );

  // try {
  //   await inventoryProducer.publishSeatAvailabilityUpdated(
  //     scheduleId,
  //     trainId,
  //     totalSeats,
  //     0,
  //     0
  //   );
  // } catch (err) {
  //   logger.error("Failed to publish initial availability event after retries", {
  //     scheduleId,
  //     error: err.message,
  //   });
  // }
});

const cancelScheduleInventory = asyncHandler(async (eventData) => {
  const data = eventData.data || eventData;

  const scheduleId = data.scheduleId || data.id;

  if (!scheduleId) {
    logger.warn(`Invalid SCHEDULE_CANCELLED event — missing scheduleId`);
    return;
  }

  const eventKey = `SCHEDULE_CANCELLED:${scheduleId}`;

  const existing = await IdempotencyRecord.findOne({ eventKey });

  if (existing) {
    logger.info(`Duplicate event skipped: ${eventKey}`);
    return;
  }

  const schedule = await ScheduleInventory.findOne({ scheduleId });

  if (!schedule) {
    logger.warn(
      `Schedule ${scheduleId} not found in inventory — skipping cancellation`
    );
    return;
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await ScheduleInventory.findOneAndUpdate(
        { scheduleId },
        {
          $set: {
            status: "CANCELLED",
            available: 0,
            locked: 0,
            booked: 0,
          },
          $inc: {
            version: 1,
          },
        },
        { session }
      );

      await SeatInventory.updateMany(
        { scheduleId },
        {
          $set: {
            status: "CANCELLED",
          },
        },
        { session }
      );

      await IdempotencyRecord.create([{ eventKey }], { session });
    });

    logger.info(`Inventory cancelled for schedule ${scheduleId}`);
  } catch (error) {
    logger.error(`Transaction Failed: ${error}`);
  } finally {
    await session.endSession();
  }

  try {
    await inventoryProducer.publishSeatAvailabilityUpdated(
      scheduleId,
      schedule.trainId,
      0,
      0,
      0
    );
  } catch (err) {
    logger.error(
      "Failed to publish cancellation availability event after retries",
      { scheduleId, error: err.message }
    );
  }
});

const getAvailability = async (scheduleId) => {
  const schedule = await ScheduleInventory.findOne({ scheduleId: scheduleId });

  if (!schedule) {
    throw new NotFoundError(`Schedule not found`);
  }

  return {
    scheduleId: schedule.scheduleId,
    trainId: schedule.trainId,
    trainNumber: schedule.trainNumber,
    trainName: schedule.trainName,
    departureDate: schedule.departureDate,
    available: schedule.available,
    locked: schedule.locked,
    booked: schedule.booked,
    status: schedule.status,
  }
};


/**
 * Helper: Recomputes the base SeatInventory status by looking at all active Segment Locks.
 * For each seat, if it has any BOOKED segment lock, the seat's status becomes BOOKED.
 * Else if it has any LOCKED segment lock, the seat's status becomes LOCKED.
 * Otherwise it becomes AVAILABLE.
 *
 * @param {mongoose.ClientSession} session - The MongoDB session for transaction consistency.
 * @param {string} scheduleId - The schedule identifier.
 * @param {string[]} seatIds - Array of seat IDs to recompute.
 */
const recomputeSegmentSeatStatuses = async (session, scheduleId, seatIds) => {
  // We loop over each seat because we need to query its segment locks individually.
  for (const seatId of seatIds) {

    // Find all active segment locks for this seat in this schedule.
    // "active" means status is either 'LOCKED' or 'BOOKED'.
    const activeLocks = await SeatSegmentLock.find({
      scheduleId,
      seatId,
      status: { $in: ['LOCKED', 'BOOKED'] }
    }).session(session);

    // Determine the new overall status
    let newStatus = 'AVAILABLE';
    if (activeLocks.some(l => l.status === 'BOOKED')) {
      // If any segment lock is BOOKED, the whole seat is considered BOOKED.
      newStatus = 'BOOKED';
    } else if (activeLocks.some(l => l.status === 'LOCKED')) {
      // Otherwise, if any is LOCKED, the seat becomes LOCKED.
      newStatus = 'LOCKED';
    }
    // If the array is empty, newStatus remains 'AVAILABLE'.

    // Update the seat inventory document with the new status.
    await SeatInventory.updateOne(
      { scheduleId, seatId },
      { $set: { status: newStatus } },
      { session }
    );
  }
};

/**
 * Helper: Recounts the total available/locked/booked seats for the whole schedule
 * by physically counting the SeatInventory rows. This prevents counter drift.
 *
 * @param {mongoose.ClientSession} session
 * @param {string} scheduleId
 * @returns {Promise<{available: number, locked: number, booked: number}>}
 */
const recountScheduleAggregates = async (session, scheduleId) => {
  // MongoDB aggregation pipeline:
  // 1. Filter documents belonging to this schedule.
  // 2. Group them by the "status" field, counting each group.
  const aggregateResult = await SeatInventory.aggregate([
    { $match: { scheduleId } },
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]).session(session);  // .session() attaches the transaction session to the aggregation.

  // The result is an array of objects like: [ { _id: 'AVAILABLE', count: 50 }, { _id: 'LOCKED', count: 5 }, ... ]
  const counts = { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 };
  aggregateResult.forEach(item => {
    if (counts[item._id] !== undefined) {
      counts[item._id] = item.count;
    }
  });

  // Update the ScheduleInventory document with the exact counts we just computed.
  await ScheduleInventory.updateOne(
    { scheduleId },
    {
      $set: {
        available: counts.AVAILABLE,
        locked: counts.LOCKED,
        booked: counts.BOOKED
      },
      $inc: { version: 1 }   // bump version because the counters changed
    },
    { session }
  );

  return {
    available: counts.AVAILABLE,
    locked: counts.LOCKED,
    booked: counts.BOOKED
  };
};

/**
 * Get all seats for a schedule, optionally filtered by status and seat type.
 * If a segment (fromSeq / toSeq) is provided, each seat gets a virtual field
 * `segmentStatus` that tells the caller whether the seat is available for that
 * specific segment.
 *
 * @param {string} scheduleId - The train schedule identifier.
 * @param {Object} [filters] - Optional filters.
 * @param {string} [filters.status] - Filter by seat status (e.g. 'AVAILABLE').
 * @param {string} [filters.seatType] - Filter by seat type.
 * @param {number|string} [filters.fromSeq] - Boarding station sequence number.
 * @param {number|string} [filters.toSeq] - Alighting station sequence number.
 * @returns {Promise<Object>} - { scheduleId, totalSeats, seats[] }
 */
const getSeats = async (scheduleId, filters = {}) => {
  // ==========================================================================
  // 1. Fetch the schedule to get totalSeats and confirm it exists.
  // ==========================================================================
  const schedule = await ScheduleInventory.findOne({ scheduleId });
  if (!schedule) throw new NotFoundError('Schedule not found in inventory');

  // ==========================================================================
  // 2. Build the base filter for SeatInventory.
  //    Every query must include the scheduleId.
  // ==========================================================================
  const where = { scheduleId };   // start with { scheduleId: 'S123' }

  // --- Apply optional filters if they were provided ---
  if (filters.status) {
    // Filter seats by status (AVAILABLE, LOCKED, BOOKED, etc.)
    where.status = filters.status;
  }
  if (filters.seatType) {
    // Filter seats by type (e.g. 'Sleeper', 'AC')
    where.seatType = filters.seatType;
  }

  // ==========================================================================
  // 3. Fetch the seats from SeatInventory.
  //    .lean() returns plain JavaScript objects (faster, easier to spread).
  // ==========================================================================
  let seats = await SeatInventory.find(where)
    .sort({ seatNumber: 1 })               // order by seat number
    .select({                               // return only needed fields
      seatId: 1,
      seatNumber: 1,
      seatType: 1,
      price: 1,
      status: 1,
      lockedBy: 1,
      lockExpiresAt: 1,
      bookingId: 1,
    })
    .lean();

  // ==========================================================================
  // 4. If a segment was requested, determine per-seat availability.
  //    The whole block only runs when fromSeq AND toSeq exist.
  // ==========================================================================
  if (filters.fromSeq !== undefined && filters.toSeq !== undefined) {
    // Convert segment endpoints to integers (they might come as strings)
    const fromSeq = parseInt(filters.fromSeq, 10);
    const toSeq   = parseInt(filters.toSeq, 10);

    // ========================================================================
    // 4a. Find all segment locks that OVERLAP with the requested segment.
    //     Overlap condition:
    //       existing.fromSeq < requested.toSeq   AND
    //       existing.toSeq   > requested.fromSeq
    //     If any active lock (LOCKED or BOOKED) overlaps, the seat is blocked.
    // ========================================================================
    const overlappingLocks = await SeatSegmentLock.find({
      scheduleId,
      status: { $in: ['LOCKED', 'BOOKED'] },
      fromSeq: { $lt: toSeq },
      toSeq:   { $gt: fromSeq },
    }).select({ seatId: 1, status: 1 }).lean();

    // Build a Set of seat IDs that are blocked by overlapping locks.
    const blockedSeatIds = new Set(overlappingLocks.map(lock => lock.seatId));

    // ========================================================================
    // 4b. Find all seats that have ANY segment lock (any segment, any status).
    //     This is used to tell the difference between:
    //       - Legacy full-journey bookings (no segment lock rows at all)
    //       - Segment bookings (have at least one segment lock row)
    // ========================================================================
    const seatsWithAnyLock = await SeatSegmentLock.find({
      scheduleId,
      status: { $in: ['LOCKED', 'BOOKED'] },
    }).select({ seatId: 1 }).lean();

    const seatsWithLocks = new Set(seatsWithAnyLock.map(lock => lock.seatId));

    // ========================================================================
    // 4c. Enrich each seat with a virtual field `segmentStatus`.
    //     Decision tree:
    //       1. Is the seat blocked by an overlapping segment lock?
    //            → UNAVAILABLE
    //       2. Is the seat LOCKED/BOOKED but has NO segment lock rows at all?
    //            → Legacy full-journey booking → UNAVAILABLE
    //       3. Otherwise → AVAILABLE
    // ========================================================================
    seats = seats.map(seat => {
      // Check 1: Overlapping segment lock
      if (blockedSeatIds.has(seat.seatId)) {
        return { ...seat, segmentStatus: 'UNAVAILABLE' };
      }

      // Check 2: Legacy full-journey booking
      // A seat is legacy-booked if its main status is LOCKED/BOOKED
      // but it has no segment lock records. Such a booking occupies the entire route.
      if (
        (seat.status === 'BOOKED' || seat.status === 'LOCKED') &&
        !seatsWithLocks.has(seat.seatId)
      ) {
        return { ...seat, segmentStatus: 'UNAVAILABLE' };
      }

      // If neither check applies, the seat is available for this segment.
      return { ...seat, segmentStatus: 'AVAILABLE' };
    });
  }

  // ==========================================================================
  // 5. Return the final response with total seats and the seats array.
  // ==========================================================================
  return {
    scheduleId,
    totalSeats: schedule.totalSeats,
    seats,
  };
};

/**
* Lock one or more seats for a given schedule.
* Supports both full‑journey and segment (partial‑journey) bookings.
*
* @param {string} scheduleId - The unique ID of the train schedule.
* @param {string[]} seatIds - Array of seat IDs to lock (e.g., ["S1", "S2"]).
* @param {string} userId - The ID of the user attempting the lock.
* @param {number} [ttlSeconds] - Lock duration in seconds (default 600s, min 60, max 600).
* @param {number} [fromSeq] - For segment booking: sequence number of boarding station.
* @param {number} [toSeq] - For segment booking: sequence number of alighting station.
* @returns {Promise<Object>} - The lock result with locked seat details and counts.
*/
const lockSeats = async (scheduleId, seatIds, userId, ttlSeconds, fromSeq, toSeq) => {
// ==========================================================================
// 1. CALCULATE LOCK TTL (TIME TO LIVE)
// ==========================================================================
// We clamp the lock duration between 60 and 600 seconds (1–10 minutes).
// If ttlSeconds is not provided, it defaults to 600.
const ttl = Math.min(Math.max(ttlSeconds || 600, 60), 600);

// ==========================================================================
// 2. SET LOCK EXPIRATION TIME
// ==========================================================================
// Date.now() gives milliseconds since 1970.
// ttl * 1000 converts seconds to milliseconds.
// lockExpiresAt is a JavaScript Date object representing the expiry moment.
const lockExpiresAt = new Date(Date.now() + ttl * 1000);

// ==========================================================================
// 3. RETRY TRANSACTION WRAPPER
// ==========================================================================
// retryTransaction is a helper that re‑runs the callback if MongoDB throws
// transient transaction errors (e.g., WriteConflict).
const result = await retryTransaction(async () => {

  // --- 3a. Start a MongoDB Session ---
  // A session is needed to run a transaction. Always `await` the creation.
  const session = await mongoose.startSession();

  // This variable will hold the final outcome of the transaction.
  let transactionResult;

  try {
    // --- 3b. Execute the actual transaction ---
    // withTransaction automatically commits if the callback succeeds,
    // or aborts if an error is thrown.
    await session.withTransaction(async () => {

      // ======================================================================
      // 4. VERIFY THAT THE SCHEDULE EXISTS AND IS ACTIVE
      // ======================================================================
      const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);
      // If the schedule is missing, we cannot continue.
      if (!schedule) throw new NotFoundError('Schedule not found in inventory');
      // Only ACTIVE schedules can accept locks/bookings.
      if (schedule.status !== 'ACTIVE') throw new BadRequestError('Schedule is not active');

      // ======================================================================
      // 5. FETCH THE REQUESTED SEATS
      // ======================================================================
      const seats = await SeatInventory.find({
        scheduleId,
        seatId: { $in: seatIds }   // $in matches any value in the array
      }).session(session);

      // ======================================================================
      // 6. ENSURE ALL SEATS EXIST
      // ======================================================================
      if (seats.length !== seatIds.length) {
        // Build a Set of found seat IDs for fast lookup
        const foundIds = new Set(seats.map(s => s.seatId));
        // Find which requested IDs are missing
        const missing = seatIds.filter(id => !foundIds.has(id));
        throw new NotFoundError(`Seats not found: ${missing.join(', ')}`);
      }

      // ======================================================================
      // 7. BRANCH BASED ON BOOKING TYPE
      // ======================================================================
      // If both fromSeq and toSeq are provided, we treat it as a segment booking.
      // Otherwise it's a full‑journey booking.
      if (fromSeq !== undefined && toSeq !== undefined) {
        // ====================================================================
        // BRANCH A: SEGMENT (PARTIAL JOURNEY) BOOKING
        // ====================================================================

        // --- A1. CHECK FOR OVERLAPPING SEGMENT LOCKS ---
        // A segment overlaps if: existing.fromSeq < new.toSeq AND existing.toSeq > new.fromSeq
        // Only active locks/bookings (status LOCKED or BOOKED) block a new lock.
        const overlapping = await SeatSegmentLock.find({
          scheduleId,
          seatId: { $in: seatIds },
          status: { $in: ['LOCKED', 'BOOKED'] },
          fromSeq: { $lt: toSeq },
          toSeq: { $gt: fromSeq }
        }).session(session);

        // If any overlapping locks exist, we cannot proceed.
        if (overlapping.length > 0) {
          // Extract unique seat IDs that are in conflict.
          // new Set(...) then spread into an array gives unique values.
          const blockedIds = [...new Set(overlapping.map(r => r.seatId))];
          throw new ConflictError(
            `Seats already locked/booked for overlapping segment: ${blockedIds.join(', ')}`
          );
        }

        // --- A2. INSERT SEGMENT LOCK ROWS ---
        // For each requested seat, create one document in the seat_segment_locks collection.
        // This records the lock at the segment level.
        const segmentLocksData = seats.map(seat => ({
          scheduleId,
          seatId: seat.seatId,
          fromSeq,
          toSeq,
          status: 'LOCKED',           // initially LOCKED, later becomes BOOKED on confirm
          lockedBy: userId,           // who holds this segment lock
          lockedAt: new Date(),       // when the lock was created
          lockExpiresAt               // when this specific lock expires
        }));
        // insertMany adds all the documents in a single operation.
        await SeatSegmentLock.insertMany(segmentLocksData, { session });

        // --- A3. UPDATE THE BASE SEAT INVENTORY WITH COALESCE LOGIC ---
        // This mirrors the SQL COALESCE: only set lockedBy/lockedAt if they are NULL,
        // but always extend lockExpiresAt.
        // We use an aggregation pipeline update (MongoDB 4.2+) to conditionally set fields.
        // IMPORTANT: Update using the primary key (_id) of the documents we just fetched.
        await SeatInventory.updateMany(
          { _id: { $in: seats.map(s => s._id) } },   // filter: exactly the documents we read
          [   // aggregation pipeline stages (array)
            {
              $set: {
                // $ifNull: if the field is null, use the second value; otherwise keep existing.
                lockedBy: { $ifNull: ['$lockedBy', userId] },
                // Preserve the original lockedAt if it exists, otherwise set to now.
                lockedAt: { $ifNull: ['$lockedAt', new Date()] },
                // Always extend the lockExpiresAt to the latest segment lock's expiry.
                lockExpiresAt: lockExpiresAt,
                // Refresh the modification timestamp.
                updatedAt: new Date()
              }
            }
          ],
          { session }
        );

        // --- A4. RECOMPUTE EACH SEAT'S OVERALL STATUS ---
        // A seat may have multiple segment locks. We derive its aggregate status
        // (AVAILABLE / LOCKED / BOOKED) by looking at all its active segment locks.
        const affectedSeatIds = seats.map(s => s.seatId);
        await recomputeSegmentSeatStatuses(session, scheduleId, affectedSeatIds);

        // --- A5. RECOUNT SCHEDULE AGGREGATES ---
        // To avoid counter drift, we physically count all seats by status and
        // update the ScheduleInventory document with the exact numbers.
        const counts = await recountScheduleAggregates(session, scheduleId);

        // --- BUILD THE RESULT FOR SEGMENT LOCK ---
        transactionResult = {
          scheduleId,
          trainId: schedule.trainId,   // from the schedule document we read
          lockedSeats: seats.map(s => ({
            seatId: s.seatId,
            seatNumber: s.seatNumber,   // correct property name
            lockExpiresAt,
          })),
          lockExpiresAt,
          counts,   // { available, locked, booked }
        };

      } else {
        // ====================================================================
        // BRANCH B: FULL‑JOURNEY BOOKING
        // ====================================================================

        // --- B1. VERIFY ALL SEATS ARE AVAILABLE ---
        // For full‑journey, we cannot lock a seat that is already LOCKED or BOOKED.
        const unavailable = seats.filter(s => s.status !== 'AVAILABLE');
        if (unavailable.length > 0) {
          throw new ConflictError(
            `Seats not available: ${unavailable.map(s => `seat #${s.seatNumber} is ${s.status}`).join(', ')}`
          );
        }

        // --- B2. ATOMICALLY LOCK THE SEATS ---
        // Update exactly the documents we fetched (by _id) to LOCKED status.
        await SeatInventory.updateMany(
          { _id: { $in: seats.map(s => s._id) } },
          {
            $set: {
              status: 'LOCKED',
              lockedBy: userId,
              lockedAt: new Date(),
              lockExpiresAt,
            },
            $inc: { version: 1 }   // optimistic concurrency control
          },
          { session }
        );

        // --- B3. UPDATE SCHEDULE COUNTERS ---
        // Mathematically adjust the aggregate counts: decrease available, increase locked.
        await ScheduleInventory.updateOne(
          { scheduleId },
          {
            $inc: {
              available: -seats.length,   // subtract number of seats just locked
              locked: seats.length,       // add to locked count
              version: 1                  // bump version
            }
          },
          { session }
        );

        // --- BUILD THE RESULT FOR FULL‑JOURNEY LOCK ---
        transactionResult = {
          scheduleId,
          trainId: schedule.trainId,
          lockedSeats: seats.map(s => ({
            seatId: s.seatId,
            seatNumber: s.seatNumber,
            lockExpiresAt,
          })),
          lockExpiresAt,
          counts: {
            available: schedule.available - seats.length,
            locked: schedule.locked + seats.length,
            booked: schedule.booked,
          },
        };
      }

    }); // end session.withTransaction

    // If we get here, the transaction committed successfully.
    return transactionResult;

  } finally {
    // --- ALWAYS END THE SESSION ---
    // The finally block runs whether we succeeded or an error was thrown.
    // This frees server resources.
    await session.endSession();
  }
});

// ==========================================================================
// 8. PUBLISH EVENT (optional, currently disabled)
// ==========================================================================
// Uncomment the block below to notify other services of the availability change.
// try {
//   await inventoryProducer.publishSeatAvailabilityUpdated(
//     result.scheduleId, result.trainId,
//     result.counts.available, result.counts.locked, result.counts.booked
//   );
// } catch (err) {
//   logger.error('Failed to publish availability after lock', { scheduleId: result.scheduleId, error: err.message });
// }

return result;
};

/**
 * Unlock one or more seats for a given schedule.
 * Supports both full‑journey and segment (partial‑journey) unlocks.
 *
 * @param {string} scheduleId - The unique ID of the train schedule.
 * @param {string[]} seatIds - Array of seat IDs to unlock.
 * @param {string} userId - The ID of the user requesting the unlock.
 * @param {number} [fromSeq] - For segment unlock: sequence number of boarding station.
 * @param {number} [toSeq] - For segment unlock: sequence number of alighting station.
 * @returns {Promise<Object>} - The unlock result with unlocked seat IDs and updated counts.
 */
const unlockSeats = async (scheduleId, seatIds, userId, fromSeq, toSeq) => {

  const result = await retryTransaction(async () => {
    // --- Start MongoDB session for transaction ---
    const session = await mongoose.startSession();

    // This will hold the final result built inside the transaction.
    let transactionResult;

    try {
      // --- Execute the actual transaction ---
      await session.withTransaction(async () => {

        // ======================================================================
        // 1. FETCH SEATS TO UNLOCK (same as FOR UPDATE NOWAIT in SQL)
        // ======================================================================
        const seats = await SeatInventory.find({
          scheduleId,
          seatId: { $in: seatIds }
        }).session(session);

        // All seats must exist
        if (seats.length !== seatIds.length) {
          throw new NotFoundError('One or more seats not found');
        }

        // ======================================================================
        // 2. BRANCH BASED ON UNLOCK TYPE
        // ======================================================================
        if (fromSeq !== undefined && toSeq !== undefined) {
          // ====================================================================
          // BRANCH A: SEGMENT UNLOCK (partial journey)
          // ====================================================================

          // --- A1. DELETE THE SPECIFIC SEGMENT LOCK ---
          // Only delete if it belongs to this user, matches the exact segment,
          // and is still in LOCKED status. This matches the Prisma DELETE statement.
          await SeatSegmentLock.deleteMany({
            scheduleId,
            seatId: { $in: seatIds },        // use the natural key
            fromSeq,
            toSeq,
            status: 'LOCKED',                // only remove locks, not bookings
            lockedBy: userId                 // only the owner's lock
          }).session(session);

          // --- A2. RECOMPUTE SEAT STATUSES ---
          // After removing a segment lock, the base seat's overall status
          // (AVAILABLE / LOCKED / BOOKED) may change.
          const affectedSeatIds = seats.map(s => s.seatId);
          await recomputeSegmentSeatStatuses(session, scheduleId, affectedSeatIds);

          // --- A3. RECOUNT SCHEDULE AGGREGATES ---
          // Ensure the schedule's counters match the actual seat counts.
          const counts = await recountScheduleAggregates(session, scheduleId);

          // --- A4. FETCH SCHEDULE FOR TRAIN ID ---
          const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

          // --- BUILD RESULT FOR SEGMENT UNLOCK ---
          transactionResult = {
            scheduleId,
            trainId: schedule.trainId,
            unlockedSeats: seats.map(s => s.seatId),
            counts,
          };

        } else {
          // ====================================================================
          // BRANCH B: FULL‑JOURNEY UNLOCK (legacy)
          // ====================================================================

          // --- B1. ALL SEATS MUST BE LOCKED ---
          const notLocked = seats.filter(s => s.status !== 'LOCKED');
          if (notLocked.length > 0) {
            throw new ConflictError(
              `Seats not in LOCKED status: ${notLocked.map(s => `seat #${s.seatNumber} is ${s.status}`).join(', ')}`
            );
          }

          // --- B2. ALL SEATS MUST BE LOCKED BY THIS USER ---
          const notOwnedByUser = seats.filter(s => s.lockedBy !== userId);
          if (notOwnedByUser.length > 0) {
            throw new ConflictError('Some seats are not locked by you');
          }

          // --- B3. UNLOCK THE SEATS ---
          // Set status back to AVAILABLE, clear lock fields, bump version.
          await SeatInventory.updateMany(
            { _id: { $in: seats.map(s => s._id) } },    // update exact documents
            {
              $set: {
                status: 'AVAILABLE',
                lockedBy: null,
                lockedAt: null,
                lockExpiresAt: null,
              },
              $inc: { version: 1 }
            },
            { session }
          );

          // --- B4. UPDATE SCHEDULE AGGREGATES MATHEMATICALLY ---
          // Increase available count, decrease locked count.
          await ScheduleInventory.updateOne(
            { scheduleId },
            {
              $inc: {
                available: seats.length,
                locked: -seats.length,
                version: 1
              },
              $set: { updatedAt: new Date() }
            },
            { session }
          );

          // --- B5. FETCH SCHEDULE (for trainId and original counts) ---
          const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

          // --- BUILD RESULT FOR FULL‑JOURNEY UNLOCK ---
          transactionResult = {
            scheduleId,
            trainId: schedule.trainId,
            unlockedSeats: seats.map(s => s.seatId),
            counts: {
              available: schedule.available + seats.length,
              locked: schedule.locked - seats.length,
              booked: schedule.booked,
            },
          };
        }

      }); // end session.withTransaction

      // If we got here, the transaction committed successfully.
      return transactionResult;

    } finally {
      // --- ALWAYS END THE SESSION ---
      await session.endSession();
    }
  });

  // ==========================================================================
  // 3. PUBLISH AVAILABILITY UPDATE (fire‑and‑forget, optional)
  // ==========================================================================
  // try {
  //   await inventoryProducer.publishSeatAvailabilityUpdated(
  //     result.scheduleId, result.trainId,
  //     result.counts.available, result.counts.locked, result.counts.booked
  //   );
  // } catch (err) {
  //   logger.error('Failed to publish availability after unlock', {
  //     scheduleId: result.scheduleId, error: err.message
  //   });
  // }

  return result;
};

/**
 * Confirm a previously created lock, turning it into a BOOKED booking.
 * Supports both full‑journey and segment (partial‑journey) confirmations.
 *
 * @param {string} scheduleId - The schedule identifier.
 * @param {string} userId - The user who owns the lock.
 * @param {string[]} seatIds - Array of seat IDs to confirm.
 * @param {string} bookingId - The booking ID to attach to the confirmed seats.
 * @param {number} [fromSeq] - Segment start sequence (boarding station).
 * @param {number} [toSeq] - Segment end sequence (alighting station).
 * @returns {Promise<Object>} - The confirmation result with updated counts.
 */
const confirmSeats = async (scheduleId, seatIds, userId, bookingId, fromSeq, toSeq) => {
  const result = await retryTransaction(async () => {

    // --- Start MongoDB session ---
    const session = await mongoose.startSession();
    let transactionResult;

    try {
      // --- Execute transaction ---
      await session.withTransaction(async () => {

        // ======================================================================
        // 1. FETCH THE SEATS (like SELECT ... FOR UPDATE NOWAIT)
        // ======================================================================
        const seats = await SeatInventory.find({
          scheduleId,
          seatId: { $in: seatIds }
        })
          .select({
            _id: 1,
            seatId: 1,
            seatNumber: 1,
            status: 1,
            lockedBy: 1
          })
          .session(session);

        if (seats.length !== seatIds.length) {
          throw new NotFoundError('One or more seats not found');
        }

        // ======================================================================
        // 2. BRANCH BASED ON CONFIRMATION TYPE
        // ======================================================================
        if (fromSeq !== undefined && toSeq !== undefined) {
          // ====================================================================
          // BRANCH A: SEGMENT CONFIRMATION
          // ====================================================================

          // --- A1. TRANSITION SEGMENT LOCK ROWS FROM LOCKED → BOOKED ---
          // Only update if the lock belongs to the user, matches the segment,
          // and is still in LOCKED status.
          const updated = await SeatSegmentLock.updateMany(
            {
              scheduleId,
              seatId: { $in: seatIds },
              lockedBy: userId,
              fromSeq,
              toSeq,
              status: 'LOCKED'
            },
            {
              $set: {
                status: 'BOOKED',
                bookingId,
                lockExpiresAt: null,
                updatedAt: new Date()
              },
              $inc: { version: 1 }
            },
            { session }
          );

          // If no rows were updated, the lock was either expired or already consumed.
          if (updated.modifiedCount === 0) {
            throw new ConflictError(
              'Segment lock expired or not found. Please lock seats again.',
              'LOCK_EXPIRED'
            );
          }

          // --- A2. RECOMPUTE THE OVERALL SEAT STATUSES ---
          // The base SeatInventory status must now reflect the presence of a BOOKED segment.
          const affectedSeatIds = seats.map(s => s.seatId);
          await recomputeSegmentSeatStatuses(session, scheduleId, affectedSeatIds);

          // --- A3. RECOUNT SCHEDULE AGGREGATES ---
          const counts = await recountScheduleAggregates(session, scheduleId);

          // --- A4. FETCH SCHEDULE FOR TRAIN ID ---
          const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

          // --- BUILD RESULT ---
          transactionResult = {
            scheduleId,
            trainId: schedule.trainId,
            bookingId,
            confirmedSeats: seats.map(s => ({
              seatId: s.seatId,
              seatNumber: s.seatNumber,
              status: 'BOOKED',
            })),
            counts,
          };

        } else {
          // ====================================================================
          // BRANCH B: FULL‑JOURNEY CONFIRMATION
          // ====================================================================

          // --- B1. VERIFY ALL SEATS ARE LOCKED ---
          const notLocked = seats.filter(s => s.status !== 'LOCKED');
          if (notLocked.length > 0) {
            throw new ConflictError(
              'Lock expired or seats not in LOCKED status. Please lock seats again.',
              'LOCK_EXPIRED'
            );
          }

          // --- B2. VERIFY ALL SEATS ARE LOCKED BY THIS USER ---
          const notOwnedByUser = seats.filter(s => s.lockedBy !== userId);
          if (notOwnedByUser.length > 0) {
            throw new ConflictError('Some seats are not locked by you');
          }

          // --- B3. TRANSITION SEATS FROM LOCKED → BOOKED ---
          await SeatInventory.updateMany(
            { _id: { $in: seats.map(s => s._id) } },
            {
              $set: {
                status: 'BOOKED',
                bookingId,
                lockExpiresAt: null,
                updatedAt: new Date()
              },
              $inc: { version: 1 }
            },
            { session }
          );

          // --- B4. UPDATE SCHEDULE AGGREGATES ---
          // Move seats from 'locked' to 'booked'. 'available' stays unchanged.
          await ScheduleInventory.updateOne(
            { scheduleId },
            {
              $inc: {
                locked: -seats.length,
                booked: seats.length,
                version: 1
              },
              $set: { updatedAt: new Date() }
            },
            { session }
          );

          // --- B5. RE‑READ SCHEDULE FOR TRAIN ID AND OLD COUNTS ---
          const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

          // --- BUILD RESULT ---
          transactionResult = {
            scheduleId,
            trainId: schedule.trainId,
            bookingId,
            confirmedSeats: seats.map(s => ({
              seatId: s.seatId,
              seatNumber: s.seatNumber,
              status: 'BOOKED',
            })),
            counts: {
              available: schedule.available,           // available unchanged
              locked: schedule.locked - seats.length, // reduced
              booked: schedule.booked + seats.length, // increased
            },
          };
        }

      }); // end session.withTransaction

      // --- RETURN THE TRANSACTION RESULT ---
      return transactionResult;

    } finally {
      // --- ALWAYS END THE SESSION ---
      await session.endSession();
    }
  });

  // ==========================================================================
  // 3. PUBLISH AVAILABILITY UPDATE (optional, fire‑and‑forget)
  // ==========================================================================
  // try {
  //   await inventoryProducer.publishSeatAvailabilityUpdated(
  //     result.scheduleId, result.trainId,
  //     result.counts.available, result.counts.locked, result.counts.booked
  //   );
  // } catch (err) {
  //   logger.error('Failed to publish availability after confirm', {
  //     scheduleId: result.scheduleId, error: err.message
  //   });
  // }

  return result;
};

/**
 * Cancel a previously confirmed booking.
 *
 * Works for both:
 *   - Segment bookings (where the booking information lives in seat_segment_locks)
 *   - Full-journey bookings (legacy, where the booking information is stored directly
 *     on the SeatInventory documents).
 *
 * The function first checks for segment locks. If any are found, it deletes them,
 * recomputes the affected seats' overall statuses and schedule aggregates, and
 * returns early. If no segment locks are found, it assumes a full-journey booking
 * and resets the seats directly.
 *
 * @param {string} scheduleId - The schedule identifier.
 * @param {string} bookingId - The booking to cancel.
 * @param {string} userId - The user requesting cancellation.
 * @returns {Promise<Object>} - Cancellation result with updated counts.
 */
const cancelBooking = async (scheduleId, bookingId, userId) => {

  const result = await retryTransaction(async () => {
    // ------------------------------------------------------------------
    // 1. Start a MongoDB session for the transaction.
    // ------------------------------------------------------------------
    const session = await mongoose.startSession();
    let transactionResult;   // will be built inside the transaction

    try {
      await session.withTransaction(async () => {

        // ===============================================================
        // 2. FIRST – CHECK FOR SEGMENT LOCKS (new booking system).
        //    Segment bookings leave rows in seat_segment_locks with the
        //    bookingId. The main SeatInventory rows may not have a
        //    bookingId for segment bookings, so we must check this
        //    collection first.
        // ===============================================================
        const segmentLocks = await SeatSegmentLock.find({
          scheduleId,
          bookingId,
          status: 'BOOKED',   // we only cancel confirmed (BOOKED) locks
        }).session(session);

        // --- If we found any segment locks, this is a segment booking. ---
        if (segmentLocks.length > 0) {

          // -- 2a. Delete ALL segment lock rows belonging to this booking.
          //       A single booking might have multiple rows (one per seat
          //       and segment), so we remove by bookingId, not by seat.
          await SeatSegmentLock.deleteMany({
            scheduleId,
            bookingId,
          }).session(session);

          // -- 2b. Collect the unique seat IDs that were affected.
          const affectedSeatIds = [...new Set(segmentLocks.map(l => l.seatId))];

          // -- 2c. Recompute the overall status (AVAILABLE/LOCKED/BOOKED)
          //       for each affected seat from the remaining segment locks.
          await recomputeSegmentSeatStatuses(session, scheduleId, affectedSeatIds);

          // -- 2d. Recount the schedule's aggregate counters to keep them
          //       perfectly in sync with the actual seat states.
          const counts = await recountScheduleAggregates(session, scheduleId);

          // -- 2e. Fetch the schedule document (we need trainId).
          const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

          // -- 2f. Build the result object for a segment cancellation.
          transactionResult = {
            scheduleId,
            trainId: schedule.trainId,
            bookingId,
            releasedSeats: affectedSeatIds,
            counts,
          };

          // IMPORTANT: Return early so the full‑journey code is NOT executed.
          return;
        }

        // ===============================================================
        // 3. SECOND – FULL‑JOURNEY BOOKING (legacy path).
        //    If we reach this point, no segment locks were found.
        //    The booking information must be stored directly on the
        //    SeatInventory rows.
        // ===============================================================

        // -- 3a. Fetch the seats that are BOOKED with the given bookingId.
        const seats = await SeatInventory.find({
          scheduleId,
          bookingId,
          status: 'BOOKED',
        })
          .select({
            _id: 1,
            seatId: 1,
            seatNumber: 1,
            status: 1,
            lockedBy: 1,
          })
          .session(session);

        // -- 3b. If no seats are found, the booking doesn't exist.
        if (seats.length === 0) {
          throw new NotFoundError('No booked seats found for this booking');
        }

        // -- 3c. Atomically reset each seat back to AVAILABLE.
        //       Clear all lock/booking fields and bump the version.
        await SeatInventory.updateMany(
          { _id: { $in: seats.map(s => s._id) } },
          {
            $set: {
              status: 'AVAILABLE',
              lockedBy: null,
              lockedAt: null,
              lockExpiresAt: null,
              bookingId: null,
            },
            $inc: { version: 1 },
          },
          { session }
        );

        // -- 3d. Read the schedule document for trainId and to build counts.
        const schedule = await ScheduleInventory.findOne({ scheduleId }).session(session);

        // -- 3e. Adjust the schedule's aggregate counters.
        await ScheduleInventory.updateOne(
          { scheduleId },
          {
            $inc: {
              available: seats.length,   // increase available
              booked: -seats.length,     // decrease booked
              version: 1,
            },
            $set: { updatedAt: new Date() },
          },
          { session }
        );

        // -- 3f. Build the result object for a full‑journey cancellation.
        transactionResult = {
          scheduleId,
          trainId: schedule.trainId,
          bookingId,
          releasedSeats: seats.map(s => s.seatId),
          counts: {
            available: schedule.available + seats.length,
            locked: schedule.locked,
            booked: schedule.booked - seats.length,
          },
        };

      }); // end session.withTransaction

      // Return the built transaction result to the retryTransaction wrapper.
      return transactionResult;

    } finally {
      // Always end the session to free server resources.
      await session.endSession();
    }

  }); // end retryTransaction

  // ------------------------------------------------------------------
  // 4. (Optional) Publish availability update event.
  // ------------------------------------------------------------------
  // try {
  //   await inventoryProducer.publishSeatAvailabilityUpdated(
  //     result.scheduleId, result.trainId,
  //     result.counts.available, result.counts.locked, result.counts.booked
  //   );
  // } catch (err) {
  //   logger.error('Failed to publish availability after cancel', {
  //     scheduleId: result.scheduleId, error: err.message
  //   });
  // }

  return result;
};

export const inventoryService = {
  initializeInventory,
  cancelScheduleInventory,
  getAvailability,
  getSeats,
  lockSeats,
  unlockSeats,
  confirmSeats,
  cancelBooking
};
