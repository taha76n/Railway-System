import express from "express";
import { stationController } from "../controllers/station.controller.js";
import getUserContext from "../middlewares/getUserContext.middleware.js";
import internalAuth from "../middlewares/internalAuth.middleware.js";

const router = express.Router();

router.get("/station", getUserContext, stationController.getAllStations);
router.get("/station/:stationId", getUserContext, stationController.getStationById);
router.post("/station", getUserContext, stationController.createStation);
router.delete("/station/:stationId", getUserContext, stationController.deleteStation)
router.patch("/station/:stationId", getUserContext, stationController.updateStation);

router.get("/station/internal/:stationId", internalAuth, stationController.getStationById);

export default router;