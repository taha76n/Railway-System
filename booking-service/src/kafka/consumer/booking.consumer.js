import { KAFKA_TOPICS } from "../../../../shared/constants/kafka-topics";
import { withDLQ } from "../../../../shared/utils/dlqhandler.js";
import { connectProducer, consumer, producer } from "../../configs/kafka.js"
import { logger } from "../../configs/logger.js";
import { bookingService } from "../../services/booking.service.js";

const start = async () => {
  await consumer.connect();
  await connectProducer();
  logger.info("Booking consumer Connected");

  await consumer.subscribe({
    topics: [
      KAFKA_TOPICS.PAYMENT_SUCCESS,
      KAFKA_TOPICS.PAYMENT_FAILED,
      KAFKA_TOPICS.SCHEDULE_CANCELLED
    ],
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_BOOKING, logger, async ({ topic, patition, message, parsedValue }) => {
      logger.info(`Received message on topic: ${topic}`, {
        partition,
        offset: message.offset,
        key: message.key?.toString(),
      });

      switch (topic) {
        case KAFKA_TOPICS.PAYMENT_SUCCESS:
          bookingService.handlePaymentSuccess(
            parsedValue.paymentOrderId,
            parsedValue.gatewayPaymentId,
            parsedValue.amount
          )
          break;
        case KAFKA_TOPICS.PAYMENT_FAILED:
          bookingService.handlePaymentFailure(
            parsedValue.paymentOrderId,
            parsedValue.reason
          )
          break;
        case KAFKA_TOPICS.SCHEDULE_CANCELLED:
          const scheduleId = parsedValue.scheduleId || parsedValue.id || (parsedValue.data && parsedValue.data.scheduleId);
          bookingService.handleScheduleCancelled(
            parsedValue.scheduleId,
          )
          break;

        default:
          logger.warn(`Unknown topic: ${topic}`);
      }
    })
  })

  logger.info('Booking consumer running');

}

export default start;