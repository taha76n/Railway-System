import mongoose from "mongoose";

const scheduleInventorySchema = new mongoose.Schema(
  {
    scheduleId: {
      type: String,
      required: true,
      unique: true, // @unique
    },
    trainId: {
      type: String,
      required: true,
      index: true, // @@index([trainId])
    },
    trainNumber: {
      type: String, // Prisma says String, not Number
      required: true,
    },
    trainName: {
      type: String,
      required: true,
    },
    departureDate: {
      type: Date, // @db.Date
      required: true,
      index: true, // @@index([departureDate])
    },
    totalSeats: {
      type: Number,
      required: true,
    },
    available: {
      type: Number,
      required: true,
    },
    locked: {
      type: Number,
      default: 0,
    },
    booked: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: "ACTIVE",
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

// @@index([scheduleId, status])
scheduleInventorySchema.index({ scheduleId: 1, status: 1 });

export const ScheduleInventory = mongoose.model(
  "ScheduleInventory",
  scheduleInventorySchema
);
