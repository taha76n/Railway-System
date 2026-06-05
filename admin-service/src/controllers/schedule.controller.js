import { scheduleService } from "../services/schedule.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError } from "../utils/error.js";

const createSchedule = asyncHandler(async (req, res) => {
  const { trainId, departureDate } = req.body;

  if (!trainId || !departureDate) {
    throw new BadRequestError("trainId and departureDate are required");
  }

  const schedule = await scheduleService.createSchedule({ trainId, departureDate });

  return res.status(201).json({
    success: true,
    message: "Train Schedule created successfully",
    data: schedule,
  });
});

const cancelSchedule = asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;

  if (!scheduleId) {
    throw new BadRequestError("ScheduleId is missing");
  }

  const schedule = await scheduleService.cancelSchedule(scheduleId);

  return res.status(200).json({
    success: true,
    message: "Schedule cancelled",
    data: schedule,
  });
});

const getAllSchedules = asyncHandler(async (req, res) => {
  const schedules = await scheduleService.getAllSchedules(req.query);
  
  return res.status(200).json({ 
    success: true, 
    data: schedules 
  });
});

export const scheduleController = {
  createSchedule,
  cancelSchedule,
  getAllSchedules,
};