import { Kafka, logLevel } from "kafkajs";
import { config } from ".";

const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKER,
  logLevel: logLevel.ERROR,
  retry: {
    initialRetryTime: 300,
    retries: 8,
    maxRetryTime: 30000,
  },
});

let isConnected = false;

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  retry: {
    retries: 5,
  },
});

const consumer = kafka.consumer({
  groupId: `inventory-service-group`,
  heartbeatInterval: 3000,
  sessionTimeout: 3000,
});

async function connectProducer() {
  if (!isConnected) {
    await producer.connect();
    isConnected = true;
  }
}

async function disconnectProducer() {
  if (isConnected) {
    await producer.disconnect();
    isConnected = false;
  }
}

export { producer, consumer, connectProducer, disconnectProducer };
