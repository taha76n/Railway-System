import mongoose from "mongoose";

// model Booking {
//   id             String        @id @default(uuid())
//   userId         String
//   scheduleId     String
//   trainId        String
//   trainNumber    String
//   trainName      String
//   departureDate  DateTime      @db.Date
//   status         BookingStatus @default(PENDING)
//   totalAmount    Float         @default(0)
//   seatCount      Int
//   fromStationId  String?       // --- SEGMENT BOOKING: boarding station ID
//   toStationId    String?       // --- SEGMENT BOOKING: alighting station ID
//   fromSeq        Int?          // --- SEGMENT BOOKING: sequence number of boarding station
//   toSeq          Int?          // --- SEGMENT BOOKING: sequence number of alighting station
//   idempotencyKey String        @unique
//   paymentOrderId String?       @unique
//   lockExpiresAt  DateTime?
//   failureReason  String?
//   version        Int           @default(0)
//   createdAt      DateTime      @default(now())
//   updatedAt      DateTime      @updatedAt

//   seats      BookingSeat[]
//   passengers Passenger[]
//   sagaLog    SagaLog[]

//   @@index([userId])
//   @@index([scheduleId])
//   @@index([status])
//   @@index([lockExpiresAt, status])
//   @@map("bookings")
// }

const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    scheduleId: {
      type: String,
      required: true,
      index: true,
    },
    trainId: {
      type: String,
      required: true,
    },
    trainNumber: {
      type: String,
      required: true,
    },
    trainName: {
      type: String,
      required: true,
    },
    departureDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      index: true,
      enum: [
        "PENDING",
        "SEATS_HELD",
        "PAYMENT_PENDING",
        "CONFIRMING",
        "CONFIRMED",
        "CANCELLING",
        "FAILED",
        "CANCELLED",
        "EXPIRED",
      ],
      default: "PENDING",
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    seatCount: {
      type: Number,
      required: true,
    },
    fromStationId: {
      type: String, // --- SEGMENT BOOKING: boarding station ID
    },
    toStationId: {
      type: String, // --- SEGMENT BOOKING: alighting station ID
    },
    fromSeq: {
      type: Number, // --- SEGMENT BOOKING: sequence number of boarding station
    },
    toSeq: {
      type: Number, // --- SEGMENT BOOKING: sequence number of alighting station
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    paymentOrderId: {
      type: String,
      sparse: true,
      unique: true,
    },
    lockExpiresAt: {
      type: Date,
    },
    failureReason: {
      type: String,
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ lockExpiresAt: 1, status: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
