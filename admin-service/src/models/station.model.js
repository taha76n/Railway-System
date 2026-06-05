import mongoose from "mongoose";

const stationSchema = new mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: true,
  },
  code: {
    type: String,
    unique: true,
    required: true,
  },
  city: {
    type:String,
    required: true
  },
  province: {
    type:String,
  },
   
}, {timestamps: true});

export const Station = mongoose.model("Station", stationSchema);

