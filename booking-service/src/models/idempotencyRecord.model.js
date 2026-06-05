import mongoose from "mongoose";

const idempotencyRecordSchema = new mongoose.Schema({
  eventKey: {
    type: String,
    required:true,
    index:true
  },
  response: {
    type: JSON
  },
  processedAt: {
    type: Date,
    default: Date.now
  }
})

const IdempotencyRecord = mongoose.model("IdemotencyRecord", idempotencyRecordSchema);

export default IdempotencyRecord;