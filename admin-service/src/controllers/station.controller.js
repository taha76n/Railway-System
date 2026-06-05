import { stationService } from "../services/station.service.js";
import {asyncHandler} from "../utils/asyncHandler.js";
import {BadRequestError} from "../utils/error.js";


const createStation = asyncHandler(async (req, res) => {
  const {name, code, city, province} = req.body;

  if (!name || !code || !city || !province) {
    throw new BadRequestError("Station code, city, name and province are required")
  }

  const result = await stationService.createStation({code: code.toUpperCase(), name, city, province});

  return res.status(201).json({
    success: true,
    message: "Station Created Successfully",
    data: result
  })
})

const getAllStations = asyncHandler(async (req, res) => {
   const stations = await stationService.getAllStations();

   return res.status(200).json({
    success: true,
    message: "All Stations Fetched Successfully",
    data: stations
   })
})

const getStationById = asyncHandler(async (req, res) => {
  const {stationId} = req.params;

   const station = await stationService.getStationById(stationId);

   return res.status(200).json({
    success: true,
    message: "Station Fetched Successfully",
    data: station
   })
})

const updateStation = asyncHandler(async (req, res) => {
  const { stationId } = req.params;
  const { code, name, city, province } = req.body;

  if (!stationId) {
    throw new BadRequestError("Station id is required");
  }

  if (!code && !name && !city && !province) {
    throw new BadRequestError("At least one field (code, name, city, province) is required");
  }

  const station = await stationService.updateStation({
    stationId,
    code,
    name,
    city,
    province,
  });

  return res.status(200).json({
    success: true,
    message: "Station Updated Successfully",
    data: station,
  });
});

const deleteStation = asyncHandler(async (req, res) => {
  const {stationId} = req.params;

  if (!stationId) {
    throw new BadRequestError("Station id is missing")
  }

  await stationService.deleteStation(stationId);

  return res.status(200).json({
    success: true,
    message: "Station Deleted Successfully",
  })
})

const getStationByIdInternal = asyncHandler(async (req, res) => {
  const { stationId } = req.params;
  if(!stationId){
       throw new BadRequestError("Station Id is missing");
  }
  const station = await stationService.getStationById(stationId);

  res.status(200).json({
       success: true,
       data: station ? {
            id: station.id,
            name: station.name,
            code: station.code,
       } : null
  });
});

export const stationController = {
  createStation,
  getStationById,
  getStationByIdInternal,
  getAllStations,
  updateStation,
  deleteStation

}