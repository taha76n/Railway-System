import mongoose from "mongoose";

// model IdempotencyRecord {
//   id          String   @id @default(uuid())
//   eventKey    String   @unique
//   response    Json?
//   processedAt DateTime @default(now())

//   @@index([eventKey])
//   @@map("idempotency_records")
// }

const idempotencyRecordSchema = new mongoose.Schema({
  eventKey: {
    type: String,
    required: true,
    unique: true,
  },
  response: {
    type: JSON,
  },
  processedAt: {
    type: Date,
    default: Date.now,
  },
});

const IdempotencyRecord = mongoose.model(
  "IdempotencyRecord",
  idempotencyRecordSchema
);

export default IdempotencyRecord;
