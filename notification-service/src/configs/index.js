const config = {
  SERVICE_NAME: "notification-service",
  PORT: Number(process.env.PORT) || 5004,
  NODE_ENV: process.env.NODE_ENV || "development",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  KAFKA_BROKER: process.env.KAFKA_BROKER,
  KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID,
  FRONTEND_URL: process.env.FRONTEND_URL,
};

export default config;
