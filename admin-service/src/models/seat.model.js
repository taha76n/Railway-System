import mongoose from "mongoose";

const seatSchema = new mongoose.Schema({
  trainId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Train",
    required: true
  },
  seatNumber: {
    type: Number,
    required: true
  },
  seatType: {
    type: String,
    enum: ["LOWER", "MIDDLE", "UPPER", "SIDE_LOWER", "SIDE_UPPER"],
    required: true
  },
  price: {
    type: Number,
    required: true
  }

}, {timestamps: true})

seatSchema.index({ trainId: 1, seatNumber: 1 }, { unique: true });

export const Seat = mongoose.model("Seat", seatSchema);