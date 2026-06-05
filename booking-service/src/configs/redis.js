import redis from "ioredis";
import { config } from ".";

class RedisClient {
  static instance;
  static isConnected = false;

  constructor() {};

  static getInstance() {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis(config.REDIS_URL,  {
        retryStrategy: (times) =>{
             const delay = Math.min(times * 50, 2000);
             return delay;
        },
        maxRetriesPerRequest: 3
   });
      RedisClient.setUpEventListeners();
    }
    return RedisClient.instance;
  }

  static setUpEventListeners() {
    RedisClient.instance.on("connect", () => {
      this.isConnected = true;
      logger.info("Connected to Redis");
    });
    RedisClient.instance.on("error", () => {
      this.isConnected = false;
      logger.error("Redis connection error");
    });
    RedisClient.instance.on("close", () => {
      this.isConnected = false;
      logger.info("Redis connection closed");
    });
    RedisClient.instance.on("reconnecting", () => {
      logger.console.warn();
      ("Reconnecting to Redis");
    });
    RedisClient.instance.on("ready", () => {
      logger.console.warn();
      ("Redis client is ready");
    });
    RedisClient.instance.on("end", () => {
      logger.console.warn();
      ("Redis connection ended");
    });
  }

  static async closeConnection() {
    try {
      await RedisClient.instance.quit();
      logger.info("Redis connection closed");
    } catch (error) {
      logger.error("Error closing Redis connection ", error);
    }
  }

  static isReady() {
    return RedisClient.isConnected;
  }
}

const redis = RedisClient.getInstance();

export { redis, RedisClient };
