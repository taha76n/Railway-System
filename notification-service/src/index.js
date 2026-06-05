import "dotenv/config"
import { logger } from "../../user-service/src/configs/logger"
import {emailConsumer} from "../src/kafka/consumer/email.consumer"

const startNotificationservice = async () => {
  try {
    logger.info("Starting notification service")
  
    const requiredEnvs = ["SMTP_USER", "SMTP_PASS", "KAFKA_BROKER"]
  
    const missing = requiredEnvs.filter(varName => !process.env[varName])
  
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }
  
    await emailConsumer.start();
  
    logger.info(`Notification Service Started Successfully`);
    logger.info(`Service is ready to process notifications`);
    
  } catch (error) {
    logger.error(`Failed to start Notification Service`, {
      error: error.message,
      stack: error.stack
    })
    process.env(1);
  }

}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

startNotificationservice();