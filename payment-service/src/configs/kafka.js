import { Kafka, logLevel } from "kafkajs";
import { config } from "./index.js";

const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKER,
  logLevel: logLevel.ERROR,
  retry: {
    initialRetryTime: 300,
    retries: 8,
    maxRetryTime: 30000
  }
});

let isConnected = false;

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  maxInFlightRequests: 5,
  idempotent: true,
  transactionTimeout: 30000,
  retry: {
    retries: 5
  }
})

const connectProducer = async () => {
  if (isConnected === false) {
    await producer.connect();
    isConnected = true;
  }
  logger.info("Kafka Producer Connected")
}

const disconnectProducer = async () => {
  if (isConnected === true) {
    await producer.disconnect();
    isConnected = false;
  }
  logger.info("Kafka Producer Disconnected")
}

export {
  producer,
  connectProducer,
  disconnectProducer
}