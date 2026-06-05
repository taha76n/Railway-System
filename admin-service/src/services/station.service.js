import { Station } from "../models/station.model.js"
import { ConflictError, NotFoundError } from "../utils/error.js";
import adminProducer from "../kafka/producer/admin.producer.js";
import { logger } from "../configs/logger.js";


const createStation = async (data) => {
  const existing = await Station.findOne({code: data.code});

  if (existing) {
    throw new ConflictError("Station code already exists") 
  }

  const station = await Station.create({
    code: data.code,
    name: data.name,
    city: data.city,
    province: data.province
  })

  logger.info(`Station created with station id ${station.id} and station code ${station.code}`)

  await adminProducer.publishStationCreated(station).catch((error) => {
    logger.info("Failed to publish station created event", {
      // error: error.message
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      type: error.type,
      fullError: error
    })
  });

  return station;
}

const getAllStations = async () => {
  const stations = await Station.find();

  if (stations.length === 0) {
    throw new NotFoundError("Stations not available. Faild to fetch all stations")
  }

  return stations;
}

const getStationById = async (stationId) => {
  const station = await Station.findById(stationId);
  
  if (!station) {
    throw new NotFoundError("Station not found. Invalid station id")
  }

  return station;
}

const updateStation = async (data) => {

  const findStation = await Station.findById(data.stationId);

  if (!findStation) {
    throw new NotFoundError("Station Not Found")
  }

  const updateObject = {}

  if (data.code) {
    updateObject.code = data.code
  }

  if (data.city) {
    updateObject.city = data.city
  }

  if (data.name) {
    updateObject.name = data.name
  }

  if (data.province) {
    updateObject.province = data.province
  }

  const station = await Station.findByIdAndUpdate(data.stationId, updateObject, {returnDocument: "after"});

  return station;

}

const deleteStation = async (stationId) => {
  
  await Station.findByIdAndDelete(stationId);

  return true;

}

export const stationService = {
  createStation,
  getStationById,
  getAllStations,
  updateStation,
  deleteStation
}