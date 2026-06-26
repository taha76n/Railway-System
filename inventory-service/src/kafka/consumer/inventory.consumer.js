import { KAFKA_TOPICS } from "../../../../shared/constants/kafka-topics.js";
import { withDLQ } from "../../../../shared/utils/dlqhandler.js";
import { connectProducer, consumer } from "../../configs/kafka.js";
import { logger } from "../../configs/logger.js";


class InventoryConsumer {
  async start() {
    await consumer.connect();
    await connectProducer();

    logger.info("Consumer Connected Successfully");

    await consumer.subscribe({
      topics: [
        KAFKA_TOPICS.SCHEDULE_CREATED,
        KAFKA_TOPICS.SCHEDULE_CANCELLED
      ],
      fromBeginning: false
    });

    await consumer.run({
      eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_INVENTORY, logger, async (topic, partition, message, parsedValue) => {
        logger.info(`Processing ${topic}`, {
          partition,
          offset: message.offset,
        });

        switch (topic) {
          case KAFKA_TOPICS.SCHEDULE_CREATED:
            await inventoryService.initializeInventory(parsedValue);
            break;

          case KAFKA_TOPICS.SCHEDULE_CANCELLED:
            await inventoryService.cancelScheduleInventory(parsedValue);
            break;

          default:
            logger.warn(`Unhandled topic: ${topic}`);
        }

      })
    })
    logger.info('Inventory consumer running...');

  }
}

export default new InventoryConsumer();