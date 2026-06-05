import { Kafka, logLevel } from "kafkajs";
import {logger} from './logger.js';
import {config} from './index.js';

const kafka = new Kafka({
     clientId: config.KAFKA_CLIENT_ID,
     brokers: [config.KAFKA_BROKER || 'localhost:9093'],
     logLevel: logLevel.ERROR,
     retry: {
          initialRetryTime: 300,  // 0.3 seconds
          retries: 8,
          maxRetryTime: 30000,  //Never wait more than 30 seconds between retries (prevents the system from hanging forever).
     },
});

const producer = kafka.producer({
     allowAutoTopicCreation: true,
     transactionTimeout: 30000,
     idempotent: true, 
     maxInFlightRequests: 5,
     retry: {
          retries: 5,
     },
});

let isConnected = false;

const connectProducer = async () => {
     if (!isConnected) {
          await producer.connect();
          isConnected = true;
          logger.info('Kafka producer connected');
     }
};

const disconnectProducer = async () => {
     if (isConnected) {
          await producer.disconnect();
          isConnected = false;
          logger.info('Kafka producer disconnected');
     }
};

export  { kafka, producer, connectProducer, disconnectProducer };