import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { logger } from "./src/configs/logger.js";
import { config } from "./src/configs/index.js";
import { reqLogger } from "./src/middlewares/req.middleware.js";

import { corsMiddleware } from "./src/middlewares/cors.middleware.js";
import { errorHandler } from "./src/middlewares/error.middleware.js";

import searchRoutes from "./src/routes/search.routes.js";


const app = express();

app.use(express.json());

app.use(express.urlencoded({extended: true}));

app.use(corsMiddleware);

app.use(cookieParser);

app.use(helmet({
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false
}))

app.use(reqLogger);

app.use(searchRoutes);

app.use(errorHandler);


const server = app.listen(config.PORT, () => {
  logger.info(`search-service is running on port ${config.PORT}`);
});
