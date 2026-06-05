import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./configs/index.js";
import { logger } from "./configs/logger.js";
import MongoDB from "./configs/mongodb.js";
import { redis, RedisClient } from "./configs/redis.js";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";

import { corsMiddleware } from "./middlewares/cors.middleware.js";
import reqLogger from "./middlewares/req.middleware.js";

const app = express();

app.use(corsMiddleware);
app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRoutes);
app.use("/user", userRoutes);

app.use(reqLogger);

app.get("/", (req, res) => {
  res.send("Hello from index.js of user-service");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    message: "ok",
  });
});

const test = async () => {
  await MongoDB.connect();
  redis;
};

test();

const server = app.listen(config.PORT, () => {
  logger.info(
    `${config.SERVICE_NAME} is running on http://localhost:${config.PORT}`
  );
});

const gracefulShutdown = () => {
  server.close(
    logger.info("Received shutdown signal, closing server gracefully"),
    process.exit(0)
  );

  setTimeout(() => {
    server.close(
      logger.info(`Forced shut down after timeout`),
      process.exit(1)
    );
  }, 30000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
