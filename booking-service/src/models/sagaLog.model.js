import mongoose from "mongoose";

// model SagaLog {
//   id        String         @id @default(uuid())
//   bookingId String
//   step      SagaStep
//   status    SagaStepStatus @default(PENDING)
//   request   Json?
//   response  Json?
//   error     String?
//   createdAt DateTime       @default(now())
//   updatedAt DateTime       @updatedAt

//   booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

//   @@index([bookingId])
//   @@map("saga_logs")
// }

const sagaLogSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    step: {
      type: String,
      enum: ["HOLD_SEATS", "CREATE_PAYMENT", "CONFIRM_SEATS", "COMPLETE"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "COMPENSATING", "COMPENSATED", "FAILED"],
      default: "PENDING",
    },
    request: {
      type: JSON,
    },
    response: {
      type: JSON,
    },
    error: {
      type: String,
    },
  },
  { timestamps: true }
);

const SagaLog = mongoose.model("SagaLog", sagaLogSchema);

export default SagaLog;
