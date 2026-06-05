import mongoose from "mongoose";
import { Train } from "../models/train.model.js";
import { BadRequestError, ConflictError } from "../utils/error.js";
import { Seat } from "../models/seat.model.js";
import adminProducer from "../kafka/producer/admin.producer.js";
import { logger } from "../configs/logger.js";

const createTrain = async (data) => {
  const { trainNumber, trainName, coachName, seats } = data;

  // Check duplicate trainNumber
  const existing = await Train.findOne({ trainNumber });
  if (existing) throw new ConflictError("Train with this number already exists");

  // Validate seat numbers
  const seatNumbers = seats.map(s => s.seatNumber);
  if (new Set(seatNumbers).size !== seatNumbers.length) {
    throw new BadRequestError("Duplicate seat numbers found");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create train (no totalSeats stored)
    const [train] = await Train.create([{
      trainNumber,
      trainName,
      coachName: coachName || 'AC',
    }], { session });

    // 2. Create seats linked to train
    const createdSeats = await Seat.insertMany(
      seats.map(seat => ({
        trainId: train._id,
        seatNumber: seat.seatNumber,
        seatType: seat.seatType,
        price: seat.price,
      })),
      { session }
    );

    await session.commitTransaction();

    // 3. Build response – totalSeats computed from createdSeats.length
    const plainTrain = train.toObject();
    plainTrain.seats = createdSeats.map(seat => seat.toObject());
    plainTrain.totalSeats = createdSeats.length;   // computed on the fly 

    // 4. Publish event
    await adminProducer.publishTrainCreated(plainTrain).catch(err => {
      logger.error('Failed to publish train created event', { error: err.message });
    });

    return plainTrain;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// train.service.js

import { Route } from "../models/route.model.js";
import { RouteStation } from "../models/routeStation.model.js";
import { Station } from "../models/station.model.js";

const createRoute = async (data) => {
  const { trainId, stations } = data;

  // 1. Validations
  const train = await Train.findById(trainId);
  if (!train) throw new NotFoundError("Train not found");

  const existingRoute = await Route.findOne({ trainId });
  if (existingRoute) throw new ConflictError("Route already exists for this train");

  const stationIds = stations.map((s) => s.stationId);
  // Fetch stations to ensure they all exist in the database
  const existingStations = await Station.find({ _id: { $in: stationIds } });
  if (existingStations.length !== stationIds.length) {
    throw new BadRequestError("One or more station IDs are invalid");
  }

  // Validate sequence
  const sorted = [...stations].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].sequenceNumber !== i + 1) {
      throw new BadRequestError("Sequence numbers must be continuous starting from 1");
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Create the Route
    const [route] = await Route.create([{ trainId }], { session });

    // 3. Create the RouteStations
    const routeStationsData = stations.map((s) => ({
      routeId: route._id,
      stationId: s.stationId,
      sequenceNumber: s.sequenceNumber,
      arrivalTime: s.arrivalTime || null,
      departureTime: s.departureTime || null,
      distanceFromOrigin: s.distanceFromOrigin || 0,
    }));

    await RouteStation.insertMany(routeStationsData, { session });

    await session.commitTransaction();

    // 4. Fetch the full Train object (using the getTrainById logic we will build next)
    const fullTrain = await getTrainById(trainId);

    // 5. Publish to Kafka
    await adminProducer.publishRouteCreated(fullTrain).catch((err) => {
      logger.error("Failed to publish route created event", { error: err.message });
    });

    return fullTrain.route; 
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getTrainById = async (trainId) => {
  // 1. Fetch the core train document
  const train = await Train.findById(trainId).lean();
  if (!train) throw new NotFoundError("Train not found");

  // 2. Fetch seats and route concurrently
  const [seats, route] = await Promise.all([
    Seat.find({ trainId }).sort({ seatNumber: 1 }).lean(),
    Route.findOne({ trainId }).lean()
  ]);

  // 3. If a route exists, fetch its stations and populate the station details
  if (route) {
    const routeStations = await RouteStation.find({ routeId: route._id })
      .sort({ sequenceNumber: 1 })
      .populate("stationId") // This acts like a join, pulling in the Station data
      .lean();
    
    // Reshape the data slightly to match your Prisma output structure
    route.routeStations = routeStations.map(rs => {
      const station = rs.stationId; 
      delete rs.stationId;
      return { ...rs, station }; 
    });
  }

  // 4. Assemble the final object
  return {
    ...train,
    seats,
    route: route || null
  };
};

const getAllTrains = async () => {
  const trains = await Train.aggregate([
    // Sort trains by number
    { $sort: { trainNumber: 1 } },
    
    // Join Seats
    {
      $lookup: {
        from: "seats", // The actual MongoDB collection name (usually pluralized)
        localField: "_id",
        foreignField: "trainId",
        pipeline: [{ $sort: { seatNumber: 1 } }],
        as: "seats"
      }
    },
    
    // Join Route
    {
      $lookup: {
        from: "routes",
        localField: "_id",
        foreignField: "trainId",
        as: "route"
      }
    },
    
    // Unwind Route array into an object (since a train has only 1 route)
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    
    // Join RouteStations to the Route
    {
      $lookup: {
        from: "routestations",
        localField: "route._id",
        foreignField: "routeId",
        pipeline: [{ $sort: { sequenceNumber: 1 } }],
        as: "route.routeStations"
      }
    }
  ]);

  return trains;
};

export const trainService = {
  createTrain,
  createRoute,
  getAllTrains,
  getTrainById
};
