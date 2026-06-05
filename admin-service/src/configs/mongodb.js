import mongoose from "mongoose";
import {logger} from "./logger.js"
import { config } from "./index.js";


class MongoDB{
  static async connect () {
    try {
       await mongoose.connect(config.DATABASE_URL);

       logger.info("MongoDB connected"); 

    } catch (error) {
      logger.error(`Mongodb Connection Error: `, error);
      process.exit(1);
    }
  }
}

export default MongoDB;