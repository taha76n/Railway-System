import { producer, connectProducer } from "../../configs/kafka.js";
import { logger } from "../../configs/logger.js";
import { KAFKA_TOPICS } from "../../../../shared/constants/kafka-topics.js";

class NotificationProducer {
  constructor () {
    this.isInitialized = false
  }

  async initialize () {
    if (!this.isInitialized) {
      await connectProducer();
      this.isInitialized = true;
    }
  }

   async sendMessage (topic, key, value) {
    try {

      await this.initialize();
      const message = {
        topic,
        messages: [{
          key: key || `${topic}-${Date.now()}`,
          value: JSON.stringify(value),
          timeStamps: Date.now().toString()
        }]
      }
      const result = await producer.send(message)
      logger.info(`Message sent to kafka topic ${topic}`, {
        key,
        partition: result[0].partition,
        offset: result[0].offset
      })
    } catch (error) {
      logger.error(`Failed to send message to kafka topic ${topic}`, {
        error: error.message,
        stack: error.stack,
        key
      })
      throw error;
    }

   } 

   async sendOtp (email, otp , ttlMinutes = 5) {
    await this.sendMessage(
      KAFKA_TOPICS.OTP_EMAIL,
      `otp-${email}`,
      {email, otp, ttlMinutes}
    )
   }

   async welcomeEmail (email, firstName) {
    await this.sendMessage(
      KAFKA_TOPICS.WELCOME_EMAIL,
      `welcome-${email}`,
       {email, firstName}
    )
   }
}

export default new NotificationProducer;