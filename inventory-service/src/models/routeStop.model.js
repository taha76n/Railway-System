import mongoose from "mongoose";

const routeStopSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: String,
      required: true,
    },
    stationId: {
      type: String,
      required: true,
    },
    stationName: {
      type: String,
      required: true,
    },
    stationCode: {
      type: String,
      required: true,
    },
    sequenceNumber: {
      type: Number,
      required: true,
    },
  },
  {
    collection: "route_stops",
    timestamps: true, // createdAt / updatedAt
  }
);

// @@unique([scheduleId, stationId])
routeStopSchema.index({ scheduleId: 1, stationId: 1 }, { unique: true });

// @@unique([scheduleId, sequenceNumber])
routeStopSchema.index({ scheduleId: 1, sequenceNumber: 1 }, { unique: true });

// @@index([scheduleId]) – already covered by the first compound index's prefix,
// but you can add it explicitly if you want a separate single-field index:
routeStopSchema.index({ scheduleId: 1 });

export const RouteStop = mongoose.model("RouteStop", routeStopSchema);
