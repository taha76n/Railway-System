import "dotenv/config";

export const config = {
  PORT: Number(process.env.PORT) || 5006,
  SERVICE_NAME: "payment-service",
  NODE_ENV: process.env.NODE_ENV || "development",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  KAFKA_BROKER: process.env.KAFKA_BROKER,
  KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || "payment-service",
  DATABASE_URL: process.env.DATABASE_URL,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,

  // Payment gateway
  PAYMENT_GATEWAY: process.env.PAYMENT_GATEWAY || "safepay",
  SAFEPAY_KEY_ID: process.env.SAFEPAY_KEY_ID,
  SAFEPAY_KEY_SECRET: process.env.SAFEPAY_KEY_SECRET,
  SAFEPAY_WEBHOOK_SECRET: process.env.SAFEPAY_WEBHOOK_SECRET,
};
