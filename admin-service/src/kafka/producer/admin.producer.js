import { connectProducer, producer } from "../../configs/kafka.js";
import { logger } from "../../configs/logger.js";
import { KAFKA_TOPICS } from "../../../../shared/constants/kafka-topics.js";

class AdminProducer {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    if (!this.isInitialized) {
    await connectProducer();
      this.isInitialized = true;
    }
  }

  async sendMessage(topic, key, value) {
    try {
      await this.initialize();
      const result = await producer.send({
        topic,
        messages: [
          {
            key: key || `${topic}-${Date.now()}`,
            value: JSON.stringify(value),
            timestamp: Date.now().toString(),
          },
        ],
      });

      logger.info(`Message sent to topic: ${topic}`, {
        key,
        partition: result[0].partition,
        offset: result[0].offset,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to send message to topic:${topic}`, {
        error: error.message,
        stack: error.stack,
        code: error.code,
        type: error.type,
        name: error.name,
        key,
      });
      throw error;
    }
  }


  async publishStationCreated(station) {
    await this.sendMessage(
      KAFKA_TOPICS.STATION_CREATED,
      `station-${station.id}`,
      {
        eventType: "STATION_CREATED",
        data: station,
        timestamp: new Date().toISOString(),
      }
    );
  }

  async publishTrainCreated(trainData) {
    await this.sendMessage(
      KAFKA_TOPICS.TRAIN_CREATED,
      `train-${trainData.id}`,
      trainData
    );
  }

  async publishRouteCreated(routeData) {
    await this.sendMessage(
      KAFKA_TOPICS.ROUTE_CREATED,
      `route-${routeData.id}`,
      routeData
    );
  }

  async publishScheduleCreated(ScheduleData) {
    await this.sendMessage(
      KAFKA_TOPICS.SCHEDULE_CREATED,
      `schedule-${ScheduleData.scheduleId}`,
      ScheduleData
    );
  }

  async publishScheduleCancelled(schedule) {
    await this.sendMessage(
      KAFKA_TOPICS.SCHEDULE_CANCELLED,
      `schedule-${schedule.id}`,
      {
        eventType: "SCHEDULE_CANCELLED",
        data: schedule,
        timestamp: new Date().toISOString(),
      }
    );
  }
}

export default new AdminProducer();
