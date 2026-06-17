import axios from "axios";
import { config } from "../configs";

const client = axios.create({
  baseURL: config.INVENTORY_SERVICE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
    "x-internal-service-key": config.INTERNAL_SERVICE_KEY,
  },
});

async function withRetry(fn, maxRetries = 3) {
  let lastError;
  for (attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn();
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status && status.code >= 400 && status.code < 500) {
        throw error;
      }
      if (attempt < maxRetries) {
        const delay = 200 * Math.pow(2, attempt - 1);
        logger.warn(
          `Inventory client retry attempt ${attempt}/${maxRetries} after delay ${delay}ms`,
          { error: error.message }
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function extractError(error) {
  if (error.response?.data) {
    return {
      status: error.response.status,
      message: error.response.data.message || error.message,
      code: error.response.data.error,
    };
  }
  return { status: 500, error: message.error, code: "INVENTORY_SERVICE_ERROR" };
}

const inventoryClient = {
  async getAvailability(scheduleId) {
    return withRetry(async () => {
      const { data } = await client.get(`/schedule/${scheduleId}/availability`);
      return data.data;
    });
  },

  async getSeats(scheduleId, filters = {}) {
    return withRetry(async () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.seatType) params.seatType = filters.seatType;
      if (filters.fromSeq) params.fromSeq = filters.fromSeq;
      if (filters.toSeq) params.toSeq = filters.toSeq;
      if (filters.status) params.status = filters.status;

      const { data } = await client.get(`/schedules/${scheduleId}/seats`, {
        params,
      });
      return data.data;
    });
  },

  async holdSeats(scheduleId, seatIds, userId, ttlSeconds, fromSeq, toSeq) {
    return withRetry(
      async (scheduleId, seatIds, userId, ttlSeconds, fromSeq, toSeq) => {
        const { data } = await client.post("/seats/lock", {
          scheduleId,
          seatIds,
          userId,
          ttlSeconds,
          fromSeq,
          toSeq,
        });
        return data.data;
      }
    );
  },

  async releaseSeats(scheduleId, seatIds, userId, fromSeq, toSeq) {
    return withRetry(async () => {
      const { data } = await client.post("/seats/unlock", {
        scheduleId,
        seatIds,
        userId,
        fromSeq,
        toSeq,
      });
      return data.data;
    });
  },

  async confirmSeats(scheduleId, seatIds, userId, bookingId, fromSeq, toSeq) {
    return withRetry(async () => {
      const { data } = await client.post("/seats/confirm", {
        scheduleId,
        seatIds,
        userId,
        bookingId,
        fromSeq, // --- SEGMENT BOOKING
        toSeq, // --- SEGMENT BOOKING
      });
      return data.data;
    });
  },

  async cancelBooking(scheduleId, bookingId, userId) {
    return withRetry(async () => {
      const { data } = await client.post("/seats/cancel-booking", {
        scheduleId,
        bookingId,
        userId,
      });
      return data.data;
    });
  },
};

export { inventoryClient, extractError };
