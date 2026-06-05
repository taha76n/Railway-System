import express from "express";
import getUserContext from "../middlewares/getUserContext.middleware.js";
import { trainController } from "../controllers/train.controller.js";

const router = express.Router();

router.post("/train", getUserContext, trainController.createTrain);
router.post("/route", getUserContext, trainController.createRoute);
router.get("/train", getUserContext, trainController.getAllTrains);
router.get("/train/:trainId", getUserContext, trainController.getTrainById);

export default router;