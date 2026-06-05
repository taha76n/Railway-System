import mongoose from "mongoose";

// model PaymentAuditLog {
//   id              String   @id @default(uuid())
//   paymentOrderId  String
//   action          String
//   gatewayResponse Json?
//   metadata        Json?
//   createdAt       DateTime @default(now())

//   paymentOrder PaymentOrder @relation(fields: [paymentOrderId], references: [id])

//   @@index([paymentOrderId])
//   @@index([action])
//   @@map("payment_audit_logs")
// }

const paymentAuditLogSchema = new mongoose.Schema({
  paymentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PaymentOrder",
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
    index: true,
  },
  gatewayResponse: {
    type: JSON,
  },
  metadata: {
    type: JSON,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const PaymentAuditLog = mongoose.model(
  "PaymentAuditLog",
  paymentAuditLogSchema
);

export default PaymentAuditLog;
