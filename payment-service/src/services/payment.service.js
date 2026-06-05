import { config } from "../configs";
import { logger } from "../configs/logger";
import IdempotencyRecord from "../models/idempotencyRecord.model";
import PaymentAuditLog from "../models/paymentAuditLog.model";
import PaymentOrder from "../models/paymentOrder.model";
import Refunds from "../models/refund.model";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/error";
import getGateway from "./gateways/gateway.factory";

const withIdempotency = async (eventKey, fn) => {
  const existing = await IdempotencyRecord.findOne({ eventKey });

  if (existing) {
    logger.info(`Idempotent request detected: ${eventKey}`);
    return existing.response;
  }

  const result = await fn();

  await IdempotencyRecord.create({ eventKey, response: result });

  return result;
};

const createPaymentOrder = async (
  bookingId,
  amount,
  userId,
  idempotencyKey
) => {
  if (!bookingId || !amount || !userId || !idempotencyKey) {
    throw new BadRequestError(
      "bookingId, amount, userId and idempotencyKey are required"
    );
  }

  if (amount <= 0) {
    throw new BadRequestError("Amount must be greater than 0");
  }

  return withIdempotency(`payment-order:${idempotencyKey}`, async () => {
    const gateway = getGateway();

    const gatewayResult = await gateway.createOrder(amount, "PKR", bookingId, {
      bookingId,
      userId,
    });

    const paymentOrder = await PaymentOrder.create({
      bookingId,
      userId,
      amount,
      currency: "PKR",
      status: "CREATED",
      idempotencyKey: idempotencyKey,
      gatewayProvider: config.PAYMENT_GATEWAY,
      gatewayOrderId: gatewayResult.gatewayOrderId,
    });

    await PaymentAuditLog.create({
      paymentOrderId: paymentOrder._id,
      action: "ORDER_CREATED",
      gatewayResponse: paymentOrder.gatewayResult.rawResponse,
      metadata: {
        bookingId,
        userId,
        amount,
      },
    });

    logger.info(`Payment order created: ${paymentOrder.id}`, {
      bookingId,
      gatewayOrderId: gatewayResult.gatewayOrderId,
    });

    return {
      paymentOrderId: paymentOrder.id,
      gatewayOrderId: gatewayResult.gatewayOrderId,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      status: paymentOrder.status,
      gatewayProvider: paymentOrder.gatewayProvider,
      keyId: config.SAFEPAY_KEY_ID,
    };
  });
};

const verifyAndCapturePayment = async (
  paymentOrderId,
  gatewayPaymentId,
  gatewaySignature
) => {
  if (!paymentOrderId || !gatewayPaymentId || !gatewaySignature) {
    throw new BadRequestError(
      "paymentOrderId,gatewayPaymentId and gatewaySignature are required"
    );
  }

  const paymentOrder = await PaymentOrder.findById(paymentOrderId);

  if (!paymentOrder) {
    throw new NotFoundError("Payment Order not found");
  }

  if (paymentOrder.status === "CAPTURED") {
    return {
      paymentOrderId: paymentOrder._id,
      status: "CAPTURED",
      gatewayPaymentId: paymentOrder.gatewayPaymentId,
      message: "Payment already Captured",
    };
  }

  if (paymentOrder.status !== "CREATED") {
    throw new ConflictError(`PaymentOrder is in ${paymentOrder.status} status`);
  }

  const gateway = getGateway();

  const isValid = gateway.verifyPaymentSignature(
    paymentOrder.gatewayOrderId,
    gatewayPaymentId,
    gatewaySignature
  );

  await PaymentAuditLog.create({
    paymentOrderId: paymentOrder._id,
    action: isValid ? "SIGNATURE VERIFIED" : "SIGNATURE_VERIFICATION_FAILED",
    metadata: { gatewayPaymentId, isValid },
  });

  if (!isValid) {
    await paymentOrder.updateOne(
      { _id: paymentOrder._id },
      {
        $set: {
          status: "FAILED",
          failureReason: "SIGNATURE_VERIFICATION_FAILED",
        },
        $inc: {
          version: 1,
        },
      }
    );

    // Publish failure
    // await paymentProducer
    //   .publishPaymentFailed(
    //     paymentOrder.id,
    //     paymentOrder.bookingId,
    //     "signature_verification_failed"
    //   )
    //   .catch((err) => {
    //     logger.error("Failed to publish PAYMENT_FAILED after sig failure", {
    //       error: err.message,
    //     });
    //   });

    throw new BadRequestError(
      "Payment signature verification failed",
      "INVALID_SIGNATURE"
    );
  }

  //Signature Valid - Capture Payment

  await paymentOrder.updateOne(
    { _id: paymentOrder._id },
    {
      $set: {
        status: "CAPTURED",
        gatewayPaymentId,
        gatewaySignature,
      },
      $inc: {
        version: 1,
      },
    }
  );

  await PaymentAuditLog.create({
    paymentOrderId: paymentOrder._id,
    action: "PAYMENT_CAPTURED_VIA_VERIFY",
    metadata: { gatewayPaymentId },
  });

  logger.info(`Payment captured via verify: ${paymentOrder.id}`);

  // Publish PAYMENT_SUCCESS
  //  await paymentProducer.publishPaymentSuccess(
  //       paymentOrder.id,
  //       paymentOrder.bookingId,
  //       gatewayPaymentId,
  //       paymentOrder.amount
  //  ).catch(err => {
  //       logger.error('Failed to publish PAYMENT_SUCCESS after verify', { error: err.message });
  //  });

  return {
    paymentOrderId: paymentOrder.id,
    status: "CAPTURED",
    gatewayPaymentId,
  };
};

const handleWebhook = async (signature, rawBody) => {
  const gateway = getGateway();

  const isValid = gateway.verifyWebhookSignature(rawBody, signature);

  if (!isValid) {
    logger.warn("Webhook verification Failed");
    throw new BadRequestError(`Invalid Webhook Signature`, `INVALID_SIGNATURE`);
  }

  const payload =
    typeof rawBody === "string"
      ? JSON.parse(rawBody)
      : JSON.parse(rawBody.toString("utf8"));

  const event = payload.event;
  const paymentEntity = payload.payload?.payment?.entity;

  if (!paymentEntity) {
    logger.warn(`Webhook payload missing payment entity`, { event });
    return { status: "ignored", event };
  }

  const gatewayOrderId = paymentEntity.order_id;
  const gatewayPaymentId = paymentEntity.id;

  const paymentOrder = await PaymentOrder.findOne({ gatewayOrderId });

  if (!paymentOrder) {
    logger.warn(`Payment order not found for gateway order ${gatewayOrderId}`);
    return { status: "ignored", reason: "order_not_found" };
  }

  await PaymentAuditLog.create({
    paymentOrderId: paymentOrder._id,
    action: `WEBHOOK_${event.toUpperCase().replace(/\./g, "_")}`,
    gatewayResponse: payload,
  });

  if (event === "payment.captured" || event === "payment.authorized") {
    return handlePaymentCaptured(paymentOrder, gatewayPaymentId, paymentEntity);
  }

  if (event === "payment.failed") {
    return handlePaymentFailed(paymentOrder, gatewayPaymentId, paymentEntity);
  }

  if (event === "refund.processed" || event === "refund.created") {
    return handleRefundProcessed(paymentOrder, payload.payload?.refund?.entity);
  }

  logger.info(`Webhook event ignored: ${event}`);
  return { status: "ignored", event };
};

const handlePaymentCaptured = async (
  paymentOrder,
  gatewayPaymentId,
  paymentEntity
) => {
  // Idempotent: already captured
  if (paymentOrder.status === "CAPTURED") {
    logger.info(`Payment already captured: ${paymentOrder.id}`);
    return { status: "already_processed" };
  }

  if (paymentOrder.status !== "CREATED") {
    logger.warn(`Cannot capture payment in status: ${paymentOrder.status}`, {
      paymentOrderId: paymentOrder.id,
    });
    return { status: "invalid_state", currentStatus: paymentOrder.status };
  }

  // Update payment order
  await PaymentOrder.updateOne(
    { _id: paymentOrder._id },
    {
      $set: {
        status: "CAPTURED",
        gatewayPaymentId,
        gatewaySignature: paymentEntity.acquirer_data?.auth_code || null,
      },
      $inc: { version: 1 },
    }
  );

  logger.info(`Payment captured: ${paymentOrder.id}`, { gatewayPaymentId });

  // Publish PAYMENT_SUCCESS to Kafka
  await paymentProducer
    .publishPaymentSuccess(
      paymentOrder.id,
      paymentOrder.bookingId,
      gatewayPaymentId,
      paymentOrder.amount
    )
    .catch((err) => {
      logger.error("Failed to publish PAYMENT_SUCCESS", { error: err.message });
    });

  return { status: "captured", paymentOrderId: paymentOrder.id };
};

const handlePaymentFailed = async (
  paymentOrder,
  gatewayPaymentId,
  paymentEntity
) => {
  // Idempotent: already failed
  if (paymentOrder.status === "FAILED") {
    return { status: "already_processed" };
  }

  if (paymentOrder.status !== "CREATED") {
    return { status: "invalid_state", currentStatus: paymentOrder.status };
  }

  const reason =
    paymentEntity.error_description ||
    paymentEntity.error_reason ||
    "payment_failed";

  await PaymentOrder.updateOne(
    { _id: paymentOrder._id },
    {
      $set: {
        status: "FAILED",
        gatewayPaymentId,
        failureReason: reason,
      },
      $inc: { version: 1 },
    }
  );

  logger.info(`Payment failed: ${paymentOrder.id}`, { reason });

  // Publish PAYMENT_FAILED to Kafka
  await paymentProducer
    .publishPaymentFailed(paymentOrder.id, paymentOrder.bookingId, reason)
    .catch((err) => {
      logger.error("Failed to publish PAYMENT_FAILED", { error: err.message });
    });

  return { status: "failed", paymentOrderId: paymentOrder.id };
};

const handleRefundProcessed = async (paymentOrder, refundEntity) => {
  if (!refundEntity) return { status: "ignored", reason: "no_refund_entity" };

  const gatewayRefundId = refundEntity.id;

  const refund = await Refunds.findOne({ gatewayRefundId });

  if (refund) {
    await Refunds.updateOne(
      { _id: refund._id },
      { $set: { status: "COMPLETED" } }
    );

    // Update parent payment order status
    const allRefunds = await Refunds.find({ paymentOrderId: paymentOrder._id });

    const totalRefunded = allRefunds
      .filter((r) => r.status === "COMPLETED" || r.id === refund.id)
      .reduce((sum, r) => sum + r.amount, 0);

    const newStatus =
      totalRefunded >= paymentOrder.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";

    await PaymentOrder.updateOne(
      { _id: paymentOrder._id },
      {
        $set: {
          status: newStatus,
        },
        $inc: {
          version: 1,
        },
      }
    );

    logger.info(`Refund processed: ${gatewayRefundId}`, { newStatus });
  }

  return { status: "refund_processed", gatewayRefundId };
};

// ─── Initiate Refund ─────────────────────────────────────────────────────────

const initiateRefund = async (
  paymentOrderId,
  amount,
  reason,
  idempotencyKey
) => {
  if (!paymentOrderId || !amount || !idempotencyKey) {
    throw new BadRequestError(
      "paymentOrderId, amount, and idempotencyKey are required"
    );
  }

  return withIdempotency(`refund:${idempotencyKey}`, async () => {
    const paymentOrder = await PaymentOrder.findById(paymentOrderId)
      .populate("refunds")
      .lean();

    if (!paymentOrder) {
      throw new NotFoundError("Payment order not found");
    }

    if (
      paymentOrder.status !== "CAPTURED" &&
      paymentOrder.status !== "PARTIALLY_REFUNDED"
    ) {
      throw new ConflictError(
        `Cannot refund payment in ${paymentOrder.status} status`
      );
    }

    if (!paymentOrder.gatewayPaymentId) {
      throw new ConflictError(
        "Payment has no gateway payment ID — cannot refund"
      );
    }

    // Check total refunded doesn't exceed original amount
    const totalRefunded = paymentOrder.refunds
      .filter((r) => r.status !== "FAILED")
      .reduce((sum, r) => sum + r.amount, 0);

    if (totalRefunded + amount > paymentOrder.amount) {
      throw new BadRequestError(
        `Refund amount (${amount}) exceeds refundable amount (${
          paymentOrder.amount - totalRefunded
        })`
      );
    }

    const gateway = getGateway();

    const gatewayResult = await gateway.initiateRefund(
      paymentOrder.gatewayPaymentId,
      amount,
      { reason, bookingId: paymentOrder.bookingId }
    );

    // Create refund record
    const refund = await Refunds.create({
      paymentOrderId: paymentOrder.id,
      amount,
      reason: reason || null,
      status: "INITIATED",
      idempotencyKey,
      gatewayRefundId: gatewayResult.gatewayRefundId,
    });

    // Update payment order status
    await PaymentOrder.updateOne(
      { _id: paymentOrder._id },
      {
        $set: {
          status: "REFUND_INITIATED",
        },
        $inc: {
          version: 1,
        },
      }
    );

    // Audit log
    await PaymentAuditLog.create({
      paymentOrderId: paymentOrder.id,
      action: "REFUND_INITIATED",
      gatewayResponse: gatewayResult.rawResponse,
      metadata: { refundId: refund.id, amount, reason },
    });

    logger.info(`Refund initiated: ${refund.id}`, {
      paymentOrderId: paymentOrder.id,
      amount,
      gatewayRefundId: gatewayResult.gatewayRefundId,
    });

    return {
      refundId: refund.id,
      paymentOrderId: paymentOrder.id,
      status: refund.status,
      amount: refund.amount,
      gatewayRefundId: gatewayResult.gatewayRefundId,
    };
  });
};

// ─── Get Payment Order ───────────────────────────────────────────────────────

const getPaymentOrder = async (paymentOrderId) => {
  const paymentOrder = await PaymentOrder.findById(paymentOrderId)
    .populate({
      path: "auditLogs",
      options: { sort: { createdAt: -1 } },
    })
    .populate({
      path: "refunds",
      options: { sort: { createdAt: -1 } },
    })
    .lean();

  if (!paymentOrder) {
    throw new NotFoundError("Payment order not found");
  }

  return paymentOrder;
};

export const paymentService = {
  createPaymentOrder,
  verifyAndCapturePayment,
  handleWebhook,
  initiateRefund,
  getPaymentOrder,
};
