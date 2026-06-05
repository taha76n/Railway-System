import mongoose from "mongoose";

// model Refund {
//   id              String       @id @default(uuid())
//   paymentOrderId  String
//   amount          Float
//   reason          String?
//   status          RefundStatus @default(INITIATED)
//   idempotencyKey  String       @unique
//   gatewayRefundId String?      @unique
//   failureReason   String?
//   metadata        Json?
//   createdAt       DateTime     @default(now())
//   updatedAt       DateTime     @updatedAt

//   paymentOrder PaymentOrder @relation(fields: [paymentOrderId], references: [id])

//   @@index([paymentOrderId])
//   @@index([status])
//   @@map("refunds")
// }

const refundSchema = new mongoose.Schema(
  {
    paymentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentOrder",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
    },
    status: {
      type: String,
      enum: ["INITIATED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "INITIATED",
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    gatewayRefundId: {
      type: String,
      unique: true,
      sparse: true,
    },
    failureReason: {
      type: String,
    },
    metadata: {
      type: JSON,
    },
  },
  { timestamps: true }
);

const Refunds = mongoose.model("refundSchema", refundSchema);

export default Refunds;
