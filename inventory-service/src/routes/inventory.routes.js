import express from "express";
import { lockSeats,unlockSeats, confirmSeats, cancelBooking } from "../services/inventory.service.js";

const router = express.Router();

// Internal: called by booking-service (protected by service key)
router.post('/seats/lock', internalAuth, lockSeats);
router.post('/seats/unlock', internalAuth, unlockSeats);
router.post('/seats/confirm', internalAuth, confirmSeats);
router.post('/seats/cancel-booking', internalAuth, cancelBooking);

export default router;