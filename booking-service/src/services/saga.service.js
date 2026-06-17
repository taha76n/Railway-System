import Booking from "../models/booking.model.js";
import SagaLog from "../models/sagaLog.model.js";
import { inventoryClient } from "./inventoryClient.js";
import { paymentClient } from "./paymentClient.js";

/**
 * Saga orchestrator for booking lifecycle.
 * Each step is logged to SagaLog for auditability and crash recovery.
 *
 * Forward flow: HOLD_SEATS -> CREATE_PAYMENT -> CONFIRM_SEATS -> COMPLETE
 * Compensation: reverse order of completed steps
 */
const executeHoldSeats = async (
  booking,
  seatIds,
  ttlSeconds,
  fromSeq,
  toSeq
) => {
  const sagalog = await SagaLog.create({
    bokingId: booking.id,
    step: "HOLD_SEATS",
    status: "PENDING",
    request: {
      scheduleId: booking.scheduleId,
      seatIds,
      userId: booking.userId,
      ttlSeconds,
      fromSeq,
      toSeq,
    }, // Segment Booking
  });

  try {
    const result = await inventoryClient.holdSeats(
      booking.scheduleId,
      seatIds,
      booking.userId,
      ttlSeconds,
      fromSeq,
      toSeq
    );

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: {
        status: "COMPLETED",
        response: result,
      },
    });

    await Booking.findByIdAndUpdate(booking._id, {
      $set: {
        status: "SEATS_HELD",
      },
    });

    logger.info(`Saga HOLD_SEATS completed for booking ${booking.id}`);

    return result;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: {
        status: "Failed",
        error: errorMessage,
      },
    });
    throw error;
  }
};

const executeCreatePayment = async (booking) => {
  const idempotencyKey = `${booking._id}-payment`;

  const sagalog = await SagaLog.create({
    bookingId: booking._id,
    step: "CREATE_PAYMENT",
    status: "PENDING",
    request: {
      bookingId: booking._id,
      amount: booking.totalAmount,
      userId: booking.userId,
    },
  });

  try {
    const result = await paymentClient.createPaymentOrder(
      booking.id,
      booking.totalAmount,
      booking.userId,
      idempotencyKey
    );

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: {
        status: "COMPLETED",
        response: result,
      },
    });

    await Booking.findByIdAndUpdate(booking._id, {
      $set: {
        status: "PAYMENT_PENDING",
        paymentOrderId: result.paymentOrderId,
      },
    });

    logger.info(`Saga CREATE_PAYMENT completed for booking ${booking.id}`);
    return result;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: { status: "FAILED", error: errorMsg },
    });
    throw error;
  }
};

const executeConfirmSeats = async (booking, seatIds, fromSeq, toSeq) => {
  const sagalog = await SagaLog.create({
    bookingId: booking._id,
    step: "CONFIRM_SEATS",
    status: "PENDING",
    request: {
      scheduleId: booking.scheduleId,
      seatIds,
      userId: booking.userId,
      bookingId: booking._id,
      fromSeq,
      toSeq,
    },
  });

  try {
    const result = await inventoryClient.confirmSeats(
      booking.scheduleId,
      seatIds,
      booking.userId,
      booking._id,
      fromSeq,
      toSeq
    );

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: {
        status: "COMPLETED",
        response: result,
      },
    });

    logger.info(`Saga CONFIRM_SEATS completed for booking ${booking.id}`);

    return result;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;

    await SagaLog.findByIdAndUpdate(sagalog._id, {
      $set: { status: "FAILED", error: errorMsg },
    });
    throw error;
  }
};

//________________COMPENSATION STEPS___________________

const compensateHoldSeats = async (booking, seatIds) => {
  logger.info(`compensating HOLD_SEATS for booking ${booking._id}`);
  try {
    await inventoryClient.releaseSeats(
      booking.scheduleId,
      seatIds,
      booking.userId,
      booking.fromSeq,
      booking.toSeq
    );

    await SagaLog.updateMany(
      { bookingId: booking._id, step: "HOLD_SEATS", status: "COMPLETED" },
      {
        $set: {
          status: "COMPENSATED",
        },
      }
    );
  } catch (error) {
    logger.error(`Failed to compensate HOLD_SEATS for booking ${booking._id}`, {
      error: error.message,
    });
  }
};

const compensateCreatePayment = async (booking) => {
  if (!booking.paymentOrderId) {
    return;
  }

  logger.info(`Compensating CREATE_PAYMENT for booking ${booking._id}`);

  try {
    const idempotencyKey = `${booking._id}-refund-compensation`;

    const result = await paymentClient.initiateRefund(
      booking.paymentOrderId,
      booking.totalAmount,
      "booking-compensation",
      idempotencyKey
    );

    await SagaLog.updateMany(
      { bookingId: booking._id, step: "CREATE_PAYMENT", status: "COMPLETED" },
      {
        $set: {
          status: "COMPENSATED",
        },
      }
    );
  } catch (error) {
    logger.error(
      `Failed to compensate CREATE_PAYMENT for booking ${booking._id}`,
      { error: error.message }
    );
  }
};

const compensateConfirmSeats = async (booking) => {
  logger.info(`Compensating CONFIRM_SEATS for booking ${booking._id} `);

  try {
    await inventoryClient.cancelBooking(
      booking.scheduleId,
      booking._id,
      booking.userId
    );

    await SagaLog.updateMany(
      { bookingId: booking._id, step: "CONFIRM_SEATS", status: "COMPLETED" },
      {
        $set: {
          status: "COMPENSATED",
        },
      }
    );
  } catch (error) {
    logger.error(
      `Failed to compensate CONFIRM_SEATS for booking ${booking._id}`,
      { error: error.message }
    );
  }
};

/**
 * Compensate all completed saga steps in reverse order.
 * Used when a booking needs to be rolled back (failure, timeout, cancellation).
 */

const compensateAll = async (booking, seatIds) => {
  const completedSteps = await SagaLog.find({bookingId: booking._id, status: "COMPLETED" }).sort({createdAt: -1})

  for (const step of completedSteps) {
    switch (step.step) {
      case "CONFIRM_SEATS":
        await compensateConfirmSeats(booking);
        break;
      case "CREATE_PAYMENT":
        await compensateCreatePayment(booking); 
        break;
      case "HOLD_SEATS":
        await compensateHoldSeats(booking, seatIds); 
        break;
    }
    
  }
}

export const sagaService = {
  executeHoldSeats,
  executeCreatePayment,
  executeConfirmSeats,
  compensateHoldSeats,
  compensateCreatePayment,
  compensateConfirmSeats,
  compensateAll
};
