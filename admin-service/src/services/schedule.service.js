import mongoose from "mongoose";
import { Schedule } from "../models/schedule.model.js";
import { trainService } from "./train.service.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/error.js";
import adminProducer from "../kafka/producer/admin.producer.js";
import { logger } from "../configs/logger.js";

const createSchedule = async (data) => {
  const { trainId, departureDate } = data;

  // 1. Fetch the rich train object using the service we built earlier
  // This already throws a NotFoundError if the train doesn't exist
  const train = await trainService.getTrainById(trainId);

  if (!train.route) {
    throw new BadRequestError("Train has no route defined. Create a route first.");
  }
  if (!train.seats || train.seats.length === 0) {
    throw new BadRequestError("Train has no seats defined.");
  }

  // 2. Date parsing and validation
  const parsedDate = new Date(departureDate);
  if (isNaN(parsedDate.getTime())) {
    throw new BadRequestError("Invalid departure date format. Use YYYY-MM-DD");
  }

  // Ensure hours are zeroed out for accurate DB querying
  parsedDate.setHours(0, 0, 0, 0);

  // 3. Check for duplicates
  const existing = await Schedule.findOne({ trainId, departureDate: parsedDate });
  if (existing) {
    throw new ConflictError("Schedule already exists for this train on this date");
  }

  // 4. Create the schedule
  const schedule = await Schedule.create({
    trainId,
    departureDate: parsedDate,
  });

  // 5. Build a rich event payload with everything consumers need
  const eventPayload = {
    scheduleId: schedule._id,
    trainId: train._id,
    trainNumber: train.trainNumber,
    trainName: train.trainName,
    coachName: train.coachName,
    totalSeats: train.seats.length,
    departureDate: schedule.departureDate,
    status: schedule.status,
    seats: train.seats.map((s) => ({
      seatId: s._id,
      seatNumber: s.seatNumber,
      seatType: s.seatType,
      price: s.price,
    })),
    route: train.route.routeStations.map((rs) => ({
      stationId: rs.station._id,
      stationName: rs.station.name,
      stationCode: rs.station.code,
      city: rs.station.city,
      province: rs.station.province, // Updated from state to province
      sequenceNumber: rs.sequenceNumber,
      arrivalTime: rs.arrivalTime,
      departureTime: rs.departureTime,
      distanceFromOrigin: rs.distanceFromOrigin,
    })),
  };

  // 6. Publish event
  await adminProducer.publishScheduleCreated(eventPayload).catch((err) => {
    logger.error("Failed to publish schedule created event", { error: err.message });
  });

  return schedule;
};

const getAllSchedules = async (query = {}) => {
  const matchStage = {};

  // Build the dynamic filters
  if (query.trainId) {
    matchStage.trainId = new mongoose.Types.ObjectId(query.trainId);
  }
  if (query.status) {
    matchStage.status = query.status;
  }
  if (query.date) {
    const qDate = new Date(query.date);
    qDate.setHours(0, 0, 0, 0);
    matchStage.departureDate = qDate;
  }

  // Execute a single aggregation pipeline to join all relational data
  return await Schedule.aggregate([
    { $match: matchStage },
    { $sort: { departureDate: 1 } },
    
    // Join Train
    {
      $lookup: {
        from: "trains",
        localField: "trainId",
        foreignField: "_id",
        as: "train",
      },
    },
    { $unwind: "$train" },

    // Join Route
    {
      $lookup: {
        from: "routes",
        localField: "trainId", // We link via trainId
        foreignField: "trainId",
        as: "train.route",
      },
    },
    { $unwind: { path: "$train.route", preserveNullAndEmptyArrays: true } },

    // Join RouteStations and deeply join Station details inside the pipeline
    {
      $lookup: {
        from: "routestations",
        localField: "train.route._id",
        foreignField: "routeId",
        pipeline: [
          { $sort: { sequenceNumber: 1 } },
          {
            $lookup: {
              from: "stations",
              localField: "stationId",
              foreignField: "_id",
              as: "station",
            },
          },
          { $unwind: "$station" },
        ],
        as: "train.route.routeStations",
      },
    },
  ]);
};

const cancelSchedule = async (scheduleId) => {
  // Use Mongoose's { new: true } to return the document *after* the update
  const schedule = await Schedule.findByIdAndUpdate(
    scheduleId,
    { status: "CANCELLED" },
    { new: true }
  );

  if (!schedule) {
    throw new NotFoundError("Schedule not found");
  }

  await adminProducer.publishScheduleCancelled(schedule).catch((err) => {
    logger.error("Failed to publish schedule cancelled event", { error: err.message });
  });

  return schedule;
};

export const scheduleService = {
  createSchedule,
  getAllSchedules,
  cancelSchedule,
};