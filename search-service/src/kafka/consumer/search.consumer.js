import { logger } from "../../configs/logger.js";
import { consumer } from "../../configs/kafka.js";
import { KAFKA_TOPICS } from "../../../../shared/constants/kafka-topics.js";

class SearchConsumer {
  async start() {
    await consumer.start();
    await producer.start(); //For DLQ Publishing

    logger.info(`Search consumer started`);

    await consumer.subscribe({
      topics: [
        KAFKA_TOPICS.STATION_CREATED,
        KAFKA_TOPICS.ROUTE_CREATED,
        KAFKA_TOPICS.SCHEDULE_CREATED,
        KAFKA_TOPICS.SCHEDULE_CANCELLED,
        KAFKA_TOPICS.SEAT_AVAILABILITY_UPDATED,
      ],
      fromBeginning: true,
    });
  }
}
