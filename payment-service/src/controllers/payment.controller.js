import { paymentService } from "../services/payment.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError } from "../utils/error.js";

const createPaymentOrder = asyncHandler(async (req, res) => {
  const { bookingId, amount, userId, idempotencyKey } = req.body;

  if (!bookingId || !amount || !userId || !idempotencyKey) {
    throw new BadRequestError(
      "bookingId, amount, userId, and idempotencyKey are required"
    );
  }

  const result = await paymentService.createPaymentOrder(
    bookingId,
    amount,
    userId,
    idempotencyKey
  );

  res.status(201).json({ success: true, data: result });
});

const getPaymentOrder = asyncHandler(async (req, res) => {
  const { paymentOrderId } = req.params;

  const result = await paymentService.getPaymentOrder(paymentOrderId);

  res.status(200).json({ success: true, data: result });
});

const verifyAndCapturePayment = asyncHandler(async (req, res) => {
  const { paymentOrderId } = req.params;
  const { gatewayPaymentId, gatewaySignature } = req.body;

  if (!gatewayPaymentId || !gatewaySignature) {
    throw new BadRequestError(
      "gatewayPaymentId and gatewaySignature are required"
    );
  }

  const result = await paymentService.verifyAndCapturePayment(
    paymentOrderId,
    gatewayPaymentId,
    gatewaySignature
  );

  res.status(200).json({ success: true, data: result });
});

const initiateRefund = asyncHandler(async (req, res) => {
  const { paymentOrderId, amount, reason, idempotencyKey } = req.body;

  if (!paymentOrderId || !amount || !idempotencyKey) {
    throw new BadRequestError(
      "paymentOrderId, amount, and idempotencyKey are required"
    );
  }

  const result = await paymentService.initiateRefund(
    paymentOrderId,
    amount,
    reason,
    idempotencyKey
  );

  res.status(201).json({ success: true, data: result });
});

export const paymentControllers = {
  createPaymentOrder,
  getPaymentOrder,
  verifyAndCapturePayment,
  initiateRefund,
};
