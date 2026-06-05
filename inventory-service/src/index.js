import express from "express";
import { logger } from "./configs/logger.js";
import { config } from "./configs/index.js";

const app = express();

const startServer = async () => {
  try {
    const server = app.listen(config.PORT, () => {
      logger.info(`inventory-service running on port ${config.PORT}`)
    })

    const shutdown = () => {
      logger.info(`Shutting down server`);
      server.close(async () => {
        logger.info(`Shutting down server`);
        process.exit(0)
      })
    }

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

  } catch (error) {
    logger.error(`Server Connection Failed ${error}`);
    process.exit(1);
  }

}

startServer()