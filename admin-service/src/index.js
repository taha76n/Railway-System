import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import {config} from "./configs/index.js";
import {logger} from "./configs/logger.js";
import MongoDB from "./configs/mongodb.js";

import stationRoutes from "./routes/station.routes.js";
import trainRoutes from "./routes/train.routes.js";
import scheduleRoutes from "./routes/schedule.routes.js";

import {corsMiddleware} from "./middlewares/cors.middleware.js";

import reqLogger from "./middlewares/req.middleware.js";

// Routes

// Middlewares

const app = express();

app.use(corsMiddleware);


// helmet setsup http headers automatically to prevent xss and clickjacking
app.use(helmet({
  crossOriginOpenerPolicy: false,  // dont set anything in this header
  crossOriginEmbedderPolicy: false  // dont set anything in this header
}))

app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());
app.use(reqLogger);

const startDb = async () => {
  await MongoDB.connect()
}

startDb();

app.get("/", (req, res) => {
  res.send("Hello from index.js of admin service");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin service is healthy",
    timestamp: new Date().toISOString(),
  });
});


app.use("/stations", stationRoutes);
app.use("/trains", trainRoutes);
app.use("/schedules", scheduleRoutes);


const startServer = async () => {
  try {
    // app.listen returns server which is an object that belongs to the core http express class
    const server = app.listen(config.PORT, () => {
      logger.info(`${config.SERVICE_NAME} is running on port ${config.PORT}`);
    });

    //Graceful Shutdown

    const shutdown = async () => {
      logger.info("Shutting down gracefully");
      // .close lets the server to gracefully shutdown by waiting for completion of  current requests stop accepting new requets and then runs the callback
      server.close(async () => {
        // await disconnectProducer();
        //server shutdown gracefully
        logger.info("Server Closed");
        process.exit(0);
      });
    };

    // process is global node.js object it represents the running app

    process.on("SIGINT", shutdown); // ctrl + c
    process.on("SIGTERM", shutdown);  // Graceful shutdown in production
  } catch (error) {
    logger.info("Failed to start Server");
     //server shutdown due to error
    process.exit(1);
  }
};

startServer();

export default app;
