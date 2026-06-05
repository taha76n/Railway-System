import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import { config } from "./configs/index.js";
import { logger } from "./configs/logger.js";

import reqLogger from "../src/middlewares/req.middleware.js"
import errorHandler from "../src/middlewares/error.middleware.js"
import notFound from "./middlewares/notFound.middleware.js";

import routes from "../src/routes/index.js"
import { corsMiddleware } from "./middlewares/cors.middleware.js";

const app = express();

app.use(corsMiddleware)

app.use(helmet())
app.use(reqLogger);

app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());

if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use("/health", (req, res) => {
  res.status(200).json({
    success: true,
    messgae: "API gateway running",
    time: new Date().toISOString(),
    environment: config.NODE_ENV
  })
})

app.use("/api", routes);

app.use(notFound);

app.use(errorHandler);


const gracefulShutdown = () => {
  logger.info(`Received shutdown signal, closing server gracefully`);
  server.close(() => {
    logger.info("server closed");
    process.exit(0)
  })

  setTimeout(() => {
    logger.info("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);


const server = app.listen(config.PORT, () => {
  logger.info(`Server is listening on port ${config.PORT} in ${config.NODE_ENV}`)
})

process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err}`)
  server.close(() => process.exit(1));
})