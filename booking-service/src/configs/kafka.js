import { Kafka, logLevel } from "kafkajs";
import { config } from "./index.js";
import { logger } from "./logger.js";

const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKER,
  logLevel: logLevel.ERROR,
  retry: {
    initialRetryTime: 30000,
    retries: 8,
    maxRetryTime: 3000,
  },
});

// Producer (for publishing BOOKING_CONFIRMED / BOOKING_CANCELLED / BOOKING_FAILED)

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  maxInFlightRequests: 5,
  idempotent: true,
  transactionTimeout: 30000,
  retry: {
    retries: 5,
  },
});

let isConnected = false;

const connectProducer = async () => {
  if (!isConnected) {
    await producer.connect();
    isConnected = true;
    logger.info("Kafka Producer Connected");
  }
};

const disconnectProducer = async () => {
  if (isConnected) {
    await producer.disconnect();
    isConnected = false;
    logger.info("Kafka Producer Disconnected");
  }
};

// Consumer (for PAYMENT_SUCCESS, PAYMENT_FAILED)
const consumer = kafka.consumer({
  groupId: "booking-service-consumer",
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});

const disconnectConsumer = async () => {
  await consumer.disconnect();
  logger.info("Kafka Consumer Disconnected");
};

const disconnectAll = async () => {
  await producer.disconnect();
  await consumer.disconnect();
};

export {
  kafka,
  producer,
  connectProducer,
  disconnectProducer,
  consumer,
  disconnectConsumer,
  disconnectAll,
};
