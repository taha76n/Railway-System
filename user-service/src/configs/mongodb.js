import mongoose from "mongoose";
import { config } from "./index.js";
import {logger} from "./logger.js";

class MongoDB {
     static async connect() {
          try {

               await mongoose.connect(config.DATABASE_URL);

               logger.info("MongoDB connected");

          } catch (error) {

               logger.error("MongoDB connection error", error);
               process.exit(1);

          }
     }
}

export default MongoDB;