import mongoose from "mongoose";

const seatSegmentLockSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: String,
      required: true,
    },
    seatId: {
      type: String,
      required: true,
    },
    fromSeq: {
      type: Number,
      required: true,
    },
    toSeq: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "LOCKED", "BOOKED", "CANCELLED"], // adjust to your actual enum
      default: "LOCKED",
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
    collection: "seat_segment_locks",
    timestamps: true,
  }
);

// @@index([scheduleId, seatId])
seatSegmentLockSchema.index({ scheduleId: 1, seatId: 1 });

// @@index([scheduleId, seatId, status])
seatSegmentLockSchema.index({ scheduleId: 1, seatId: 1, status: 1 });

// @@index([lockExpiresAt, status])
seatSegmentLockSchema.index({ lockExpiresAt: 1, status: 1 });

export const SeatSegmentLock = mongoose.model(
  "SeatSegmentLock",
  seatSegmentLockSchema
);
