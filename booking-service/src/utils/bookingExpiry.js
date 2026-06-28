import { logger } from "../configs/logger.js";
import Booking from "../models/booking.model.js";
import BookingSeat from "../models/bookingSeat.model.js";
import { userClient } from "../services/userClient.js"


const fetchUserForNotification = async (userId) => {
  try {
    const user = await userClient.getUserById(userId);
    return user ? { email: user.email, firstName: user.firstName } : {}
  } catch (error) {
    logger.error(`Failed to enrich expiry event with user details`, {
      userId,
      error: error.message
    });
    return {};
  }
}

let expiryInterval = null;

const leaderKey = `booking:expiry-job:leader`;
const leaderTTlSeconds = 25;

const tryAcquireLeadership = async () => {
  try {
    const result = await redis.set(leaderKey, process.pid.toString(), "NX", "EX", leaderTTlSeconds);
    return result === "OK"
  } catch (error) {
    logger.error(`Failed to acquire expiry job leadership`, {
      error: error.message
    })
    return false;
  }
}

const cleanExpiredBookings = async () => {

  const isLeader = await tryAcquireLeadership();
  if (!isLeader) {
    logger.debug(`skipping expiry job another instance is leader`);
    return;
  }

  try {
    const expiredBookings = await Booking.find({
      status: {
        $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING"]
      },
      lockExpiresAt: { $lt: new Date }
    }).lean();

    const seats = await BookingSeat.find({ bookingId: booking._id });

    expiredBookings.seats = seats;

    if (expiredBookings.length === 0) {
      return;
    }

    logger.info(`Found ${expiredBookings.length} expired bookings to cleanup`);

    for (const booking of expiredBookings) {
      try {
        const seatIds = booking.seats.map((s) => { s.seatId }).sort();

        const claimed = Booking.updateMany({
          _id: booking._id,
          version: booking.__v,
          status: { $in: ["PENDING", "SEATS_HELD", "PAYMENT_PENDING"] }
        }, {
          $set: {
            status: "EXPIRED",
            failureReason: "booking_timeout"
          },
          $inc: {
            version: 1
          }
        })

        if (claimed.matchedCount === 0) {
          logger.info(`Booking ${booking.id} already handled by another process, skipping expiry`);
          continue;
        }

        // Compensate all completed saga steps
        await compensateAll(booking, seatIds);

        // Release Redis locks (segment-aware)
        await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

        // Publish BOOKING_FAILED
        try {
          const userInfo = await fetchUserForNotification(booking.userId);
          await bookingProducer.publishBookingFailed({
            bookingId: booking.id,
            userId: booking.userId,
            email: userInfo.email,
            firstName: userInfo.firstName,
            scheduleId: booking.scheduleId,
            reason: 'booking_timeout',
          });
        } catch (err) {
          logger.error('Failed to publish BOOKING_FAILED for expired booking', {
            bookingId: booking.id,
            error: err.message,
          });
        }

        logger.info(`Expired booking ${booking.id} cleaned up`, {
          previousStatus: booking.status,
        });

      } catch (error) {
        logger.error(`Failed to clean up expired booking ${booking.id}`, {
          error: error.message,
        });
      }
    }
  }catch(error){
    logger.error('Error in booking expiry job', { error: error.message });

  }
}


const startBookingExpiryJob = () => {
  // Run immediately once
  cleanExpiredBookings();

  // Then run on interval
  expiryInterval = setInterval(cleanExpiredBookings, config.BOOKING_EXPIRY_CHECK_INTERVAL_MS);
  logger.info(
       `Booking expiry job started (interval: ${config.BOOKING_EXPIRY_CHECK_INTERVAL_MS}ms)`
  );
}

const stopBookingExpiryJob = () => {
  if (expiryInterval) {
       clearInterval(expiryInterval);
       expiryInterval = null;
       logger.info('Booking expiry job stopped');
  }
}

export {
  startBookingExpiryJob,
  stopBookingExpiryJob
}
    
  
