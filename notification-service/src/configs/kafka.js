import {Kafka, logLevel} from "kafkajs";
import { config } from "../../../user-service/src/configs";
import { logger } from "../../../user-service/src/configs/logger";


const kafka =  new Kafka ({
  clientId: config.clientId,
  brokers: [ config.KAFKA_BROKER || "localhost:9093"],
  logLevel: logLevel.ERROR,
  retry: {
    initialRetryTime: 300,
    retries: 10,
    maxRetryTime: 30000,
    multiplier: 2
  }
})

const consumer = kafka.consumer({
    groupId: "notification-service-group",
    heartbeatInterval: 3000,
    sessionTimeout: 3000
  })

// producer (used only for DLQ publishing )
const producer = kafka.producer({
    allowAutoTopicCreation: true,    
    retry: {
      retries: 3
    }
  })


let isConnected = false;

const connectProducer = async() => {
  if (!isConnected) {
    await producer.connect();
    isConnected = true;
    logger.info("kafka producer connected to DLQ")
  }
}

// Graceful shutdown
const shutdown = async () => {
  logger.info("shutting down kafka connections");
  await consumer.disconnect();
  if (isConnected) {
    await producer.disconnect();
    isConnected = false;
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export {
  kafka,
  producer,
  connectProducer,
  consumer,
  shutdown
}