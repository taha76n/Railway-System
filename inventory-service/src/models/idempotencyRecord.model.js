import mongoose from "mongoose";

const idempotencyRecordSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true, // @unique
      index: true, // @@index([eventKey]) – unique already creates an index
    },
    processedAt: {
      type: Date,
      default: Date.now, // function, not called
    },
  },
  {
    collection: "idempotency_records", // @@map
    timestamps: false, // only processedAt, no createdAt/updatedAt
  }
);

export const IdempotencyRecord = mongoose.model(
  "IdempotencyRecord",
  idempotencyRecordSchema
);
