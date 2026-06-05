import mongoose from "mongoose";

const seatInventorySchema = new mongoose.Schema(
  {
    scheduleInventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScheduleInventory", // references the model name
      required: true,
    },
    scheduleId: {
      type: String,
      required: true,
    },
    seatId: {
      type: String,
      required: true,
    },
    seatNumber: {
      type: Number,
      required: true,
    },
    seatType: {
      type: String,
      required: true,
    },
    price: {
      type: Number, // Prisma Float → Mongoose Number
      required: true,
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "LOCKED", "BOOKED", "CANCELLED"], // add all possible SeatStatus values
      default: "AVAILABLE",
    },
    lockedBy: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockExpiresAt: { type: Date, default: null },
    bookingId: {
      type: String,
      default: null,
      index: true, // @@index([bookingId])
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// @@unique([scheduleId, seatId])
seatInventorySchema.index({ scheduleId: 1, seatId: 1 }, { unique: true });

// @@unique([scheduleId, seatNumber])
seatInventorySchema.index({ scheduleId: 1, seatNumber: 1 }, { unique: true });

// @@index([scheduleId, status])
seatInventorySchema.index({ scheduleId: 1, status: 1 });

// @@index([lockExpiresAt, status])
seatInventorySchema.index({ lockExpiresAt: 1, status: 1 });

export const SeatInventory = mongoose.model(
  "SeatInventory",
  seatInventorySchema
);
