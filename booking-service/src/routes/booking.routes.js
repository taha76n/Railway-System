import express from "express";
import { bookingController } from "../controllers/booking.controller.js";
import { getUserContext } from "../middlewares/getUserContext.middleware.js";

const router = express.Router();

router.post("/bookings", getUserContext, bookingController.createBooking);
router.get("/bookings", getUserContext, bookingController.getUserBookings);
router.get(
  "/bookings/:bookingId",
  getUserContext,
  bookingController.getBooking
);
router.post(
  "/bookings/:bookingId/verify-payment",
  getUserContext,
  bookingController.verifyPayment
);
router.post(
  "/bookings/:bookingId/cancel",
  getUserContext,
  bookingController.cancelBooking
);

export default router;
