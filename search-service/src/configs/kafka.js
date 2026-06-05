import { Kafka, logLevel } from "kafkajs";
import { config } from "./index.js";
import { logger } from "./logger.js";

const kafka = new Kafka({
  brokers: config.KAFKA_BROKER,
  clientId: config.KAFKA_CLIENT_ID,
  logLevel: logLevel.ERROR,
  retry: { initialRetryTime: 300, retries: 8, maxRetryTime: 30000 },
});

const consumer = kafka.consumer({
  groupId: "search-service-group-v2",
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});

// For DLQ Publishing
const producer = kafka.producer({
  allowAutoTopicCreation: true,
  retry: { retries: 3 },
});

let isProducerConnected = false;

const connectProducer = async () => {
  if (!isProducerConnected) {
    await producer.connect();
    isProducerConnected = true;
  }
};

const disconnectAll = async () => {
  consumer.disconnect();

  if (isProducerConnected) {
    await producer.disconnect();
    isProducerConnected = false;
  }
  logger.info("kafka consumer disconnected");
};

export { consumer, producer, connectProducer, disconnectAll };
