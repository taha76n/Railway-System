import mongoose from "mongoose";

const routeStationSchema = new mongoose.Schema({
  routeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Route",
    required: true
  },
  stationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Station",
    required: true
  },
  sequenceNumber: {
    type: Number,
    required: true
  },
  arrivalTime: {
    type: String,
  },
  departureTime: {
    type: String,
  },
  distanceFromOrigin: {
    type: Number,
    default: 0
  }

}, {timestamps: true})

routeStationSchema.index({routeId: 1, sequenceNumber: 1}, {unique: true});
routeStationSchema.index({routeId: 1, stationId: 1}, {unique: true});

routeStationSchema.index({ routeId: 1 });


export const RouteStation = mongoose.model("RouteStation", routeStationSchema)

