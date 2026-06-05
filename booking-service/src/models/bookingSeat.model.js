import mongoose from "mongoose";

// model BookingSeat {
//   id         String   @id @default(uuid())
//   bookingId  String
//   seatId     String
//   seatNumber Int
//   seatType   String
//   price      Float
//   createdAt  DateTime @default(now())

//   booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

//   @@unique([bookingId, seatId])
//   @@map("booking_seats")
// }

const bookingSeatSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    seatId: {
      type: String,
      required: true,
    },
    seatNumber: {
      type: Number,
      required: true,
    },
    seatType: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

bookingSeatSchema.index({ bookingId: 1, seatId: 1 }, { unique: true });

const BookingSeat = mongoose.model("BookingSeat", bookingSeatSchema);

export default BookingSeat;
