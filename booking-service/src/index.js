import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { config } from "./configs/index.js";
import { logger } from "./configs/logger.js";

import { reqLogger } from "./middlewares/req.middleware.js";
import { corsMiddleware } from "./middlewares/cors.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

import bookingRoutes from "./routes/booking.routes.js"

const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(corsMiddleware);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  })
);

app.use(cookieParser());

app.use(reqLogger);

app.get("/", (req, res) => {
  res.status(200).json({ message: `Hello from index.js of booking-service` });
});

app.get("/health", (req, res) => {
  res.status(200).json({ message: "ok" });
});

app.use(bookingRoutes);

app.use(errorHandler);

const startServer = async () => {
  try {
    const server = app.listen(config.PORT, () => {
      logger.info(`booking-service running on port ${config.PORT}`);
    });

    const shutdown = async () => {
      logger.info(`Shutting down gracefully`);

      server.close(async () => {
        logger.info(`server stopped`);
        process.exit(0);
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    logger.error("Failed to start server ", error);
    process.exit(1);
  }
};

startServer();
