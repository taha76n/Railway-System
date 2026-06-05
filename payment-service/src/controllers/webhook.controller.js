import { logger } from "../configs/logger.js";
import { paymentService } from "../services/payment.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const safepayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-sfpy-signature"] || req.headers["x-safepay-signature"];

  if (!signature) {
    logger.warn("Webhook received without signature header");
    return res
      .status(400)
      .json({ status: "error", message: "Missing signature" });
  }

  const rawBody = req.body;

  const result = await paymentService.handleWebhook(signature, rawBody);

  logger.info(`Webhook Processed: ${result}`);

  res.status(200).json({
    status: "ok",
    ...result,
  });
});
