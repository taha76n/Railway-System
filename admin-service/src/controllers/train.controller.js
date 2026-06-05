import { trainService } from "../services/train.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError } from "../utils/error.js";

const createTrain = asyncHandler(async (req, res) => {
  const { trainNumber, trainName, coachName, seats } = req.body;

  if (!trainNumber || !trainName || !coachName || !seats) {
    throw new BadRequestError(
      "Train number, name, coach name and seats are required"
    );
  }

  if (!Array.isArray(seats) || seats.length === 0) {
    throw new BadRequestError("At least one seat must be defined...");
  }

  const plainTrain = await trainService.createTrain({
    trainNumber,
    trainName,
    coachName: coachName || "AC",
    seats,
  });

  return res.status(201).json({
    success: true,
    message: "Train Created Successfully",
    data: plainTrain,
  });
});

const createRoute = asyncHandler(async (req, res) => {
  const { trainId, stations } = req.body;

  if (!trainId || !stations) {
    throw new BadRequestError("Train Id and stations are required");
  }

  if (!Array.isArray(stations) || stations.length < 2) {
    throw new BadRequestError("A route must have at least 2 stations (origin and destination)");
  }

  const route = await trainService.createRoute({ trainId, stations });

  return res.status(201).json({
    success: true,
    message: "Route Created Successfully",
    data: route,
  });
});

const getAllTrains = asyncHandler(async (req, res) => {
  const trains = await trainService.getAllTrains();

  return res.status(200).json({
    success: true,
    message: "Trains Fetched Successfully",
    data: trains,
  });
});

const getTrainById = asyncHandler(async (req, res) => {
  const { trainId } = req.params;

  if (!trainId) {
    throw new BadRequestError("Train Id is missing");
  }

  const train = await trainService.getTrainById(trainId);

  return res.status(200).json({
    success: true,
    message: "Train Fetched Successfully",
    data: train,
  });
});

export const trainController = {
  createTrain,
  createRoute,
  getAllTrains,
  getTrainById,
};