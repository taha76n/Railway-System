import express from "express";
import { scheduleController } from "../controllers/schedule.controller.js";

const router = express.Router();

router.post("/schedule", scheduleController.createSchedule)
router.post("/schedule/:scheduleId", scheduleController.cancelSchedule)
router.get("/schedule", scheduleController.getAllSchedules)

export default router;