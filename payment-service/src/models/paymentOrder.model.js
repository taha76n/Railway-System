import mongoose from "mongoose";
// enum PaymentOrderStatus {
//   CREATED
//   CAPTURED
//   FAILED
//   REFUND_INITIATED
//   REFUNDED
//   PARTIALLY_REFUNDED
// }

// model PaymentOrder {
//   id               String             @id @default(uuid())
//   bookingId        String
//   userId           String
//   amount           Float
//   currency         String             @default("INR")
//   status           PaymentOrderStatus @default(CREATED)
//   idempotencyKey   String             @unique
//   gatewayProvider  String             @default("razorpay")
//   gatewayOrderId   String?            @unique
//   gatewayPaymentId String?            @unique
//   gatewaySignature String?
//   failureReason    String?
//   metadata         Json?
//   version          Int                @default(0)
//   createdAt        DateTime           @default(now())
//   updatedAt        DateTime           @updatedAt

//   auditLogs PaymentAuditLog[]
//   refunds   Refund[]

//   @@index([bookingId])
//   @@index([userId])
//   @@index([status])
//   @@map("payment_orders")
// }

const paymentOrderSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: "PKR",
    },
    status: {
      type: String,
      enum: [
        "CREATED",
        "CAPTURED",
        "FAILED",
        "REFUND_INITIATED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      required: true,
      index: true,
      default: "CREATED",
    },
    idempotencyKey: {
      type: String,
      unique: true,
      required: true,
    },
    gatewayProvider: {
      type: String,
      default: "",
    },
    gatewayOrderId: {
      type: String,
      unique: true,
      sparse: true,
    },
    gatewayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    gatewaySignature: {
      type: String,
    },
    failureReason: {
      type: String,
    },
    metadata: {
      type: JSON,
    },
    version: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  },
);

// Virtual populate for audit logs
paymentOrderSchema.virtual('auditLogs', {
ref: 'PaymentAuditLog',
localField: '_id',
foreignField: 'paymentOrderId',
});

// Virtual populate for refunds
paymentOrderSchema.virtual('refunds', {
ref: 'Refund',
localField: '_id',
foreignField: 'paymentOrderId',
});

const PaymentOrder = mongoose.model("PaymentOrder", paymentOrderSchema);

export default PaymentOrder;
