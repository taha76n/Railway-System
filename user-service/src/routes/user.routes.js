import express from "express";
import { userController } from "../controllers/user.controller.js";
import getUserContext from "../middlewares/getUserContext.middleware.js"
import internalAuth from "../middlewares/internalAuth.middleware.js";

const router = express.Router();

router.get("/profile",  getUserContext, userController.getProfile );
router.delete("/profile", getUserContext, userController.deleteUserAccount);
router.patch("/profile", getUserContext, userController.updateprofile);

router.get("/internal/:userId", internalAuth, userController.getUserInternal);

export default router;