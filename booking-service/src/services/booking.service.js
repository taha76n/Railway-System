import { IdempotencyRecord } from "../../../inventory-service/src/models/idempotencyRecord.model"
import { logger } from "../configs/logger.js";
import { BadRequestError } from "../utils/error.js"
import { inventoryClient } from "./inventoryClient.js";

const checkIdempotency = async (key) => {
  const existing = await IdempotencyRecord.findOne({eventKey: key});
  if (existing) {
    logger.info(`Idempotent Request: ${key}`)
    return existing.response;
  }
  return null;
}

const createBooking = async (userId, scheduleId, seatIds, passengers, idempotencyKey, fromStationId, toStationId, fromSeq, toSeq) => {
  
  // 1. Validate Input

  if(!scheduleId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0){
    throw new BadRequestError("ScheduleId and seatIds(non-empty array) is required")
  }

  if(!passengers|| !Array.isArray(passengers) || passengers.length === 0){
    throw new BadRequestError("passengers(non-empty array) is required")
  }
  
  if (seatIds.length !== passengers.length) {
    throw new BadRequestError("Number of seats must match number of passengers")
  }
  
  if (!idempotencyKey) {
    throw new BadRequestError("idempotency key is required")
  }
  
  //Segment Booking
  if(fromSeq && toSeq && fromSeq >= toSeq) {
    throw new BadRequestError("fromStation must come before toStation")
  }

  // 2. Check Idempotency
  const cached = checkIdempotency(idempotencyKey);

  if(cached) return cached;

  // 3. Fetch schedule availability and seat details from inventory

  const availability = inventoryClient.getAvailability(scheduleId);

  if (availability.status !== "ACTIVE") {
    throw new BadRequestError("Schedule is not active")
  }

  // Prevent booking trains that have already departed
  if (new Date(availability.departureDate) < new Date()) {
    throw new BadRequestError('Cannot book a train that has already departed');
  }

  const seatData = await inventoryClient.getSeats(scheduleId, {
    fromSeq: fromSeq || undefined,
    toSeq: toSeq || undefined
  })

  const seatMap = new Map(seatData.seats.map(s => [s.seatId, s]));

  


}

export const bokingService = {
  createBooking,

}