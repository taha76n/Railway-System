import { logger } from "../../../../user-service/src/configs/logger"
import { connectProducer, consumer, producer } from "../../configs/kafka"
import {KAFKA_TOPICS} from "../../../../shared/constants/kafka-topics";
import emailService from "../../services/email.service";

class EmailConsumer {
  async start() {
       try {
            await consumer.connect();
            // await connectProducer(); // Uncomment this when you add DLQ back
            logger.info("Email Consumer connected to kafka");

            await consumer.subscribe({
                 topics: Object.values(KAFKA_TOPICS), // Must be 'topics' (plural) for KafkaJS
                 fromBeginning: false
            });

            await consumer.run({
                 eachMessage: async ({ topic, partition, message }) => {
                      try {
                           const rawString = message.value.toString();
                           const parsedValue = JSON.parse(rawString); // Standardized camelCase

                           logger.info(`Processing message from topic ${topic}`);
                           
                           // Pass the parsed object, not the raw network message
                           await this.handleMessage(topic, parsedValue); 

                      } catch (error) {
                           logger.error(`CRITICAL: Failed to process message from ${topic}`, {
                                error: error.message,
                                offset: message.offset,
                                rawPayload: message.value?.toString()
                           });
                      }
                 }
            }); // Closing the consumer.run object correctly

            // This goes OUTSIDE the eachMessage loop. 
            // It logs once when the background thread successfully starts.
            logger.info('Email consumer is running and listening for messages...');

       } catch (error) {
            logger.error('Failed to start email consumer', { error: error.message });
            throw error;
       }
  }

   async handleMessage (topic, data) {
    switch (topic) {
      case KAFKA_TOPICS.OTP_EMAIL:
        await this.handleOtpEmail(data)
        break;
      case KAFKA_TOPICS.WELCOME_EMAIL:
        await this.handleWelcomeEmail(data)
        break;
    
      default:
        logger.error(`Unknow topic: ${topic}`)
    }

   }

   async handleOtpEmail (data) {
    const {email, otp, ttlMinutes} = data;
    if (!email || !otp) {
      throw new Error (`Missing required Fields: email and otp`)
    }
    await emailService.sendOtpEmail(email, otp, ttlMinutes)
    logger.info(`Otp email sent to ${email}`)
   }

   async handleWelcomeEmail (data) {
    const {email, firstName} = data;
    if (!email || !firstName) {
      throw new Error (`Missing required Fields: email and firstName`)
    }
    await emailService.sendWelcomeEmail(email, firstName);
    logger.info(`Welcome email sent to ${email}`)

   }
}

export default new EmailConsumer();