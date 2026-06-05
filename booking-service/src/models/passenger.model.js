import mongoose from "mongoose";

// model Passenger {
//   id        String   @id @default(uuid())
//   bookingId String
//   name      String
//   age       Int
//   gender    String
//   seatId    String?
//   createdAt DateTime @default(now())

//   booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

//   @@map("passengers")
// }

const passengerSchema  = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true
  },
  name: {
    type: String,
    required: true
  },
  age: {
    type: Number,
    required: true
  },
  gender: {
    type: String,
    required: true

  },
  seatId: {
    type: String

  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

const Passenger = mongoose.model("Passenger", passengerSchema);

export default Passenger;