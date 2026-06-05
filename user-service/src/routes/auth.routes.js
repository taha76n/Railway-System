import express from "express";
import { authController } from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.post("/login", authController.login);
router.post("/rotate-refresh-token", authController.rotateRefreshToken);
router.post("/google-auth", authController.verifyGoogleIdToken);


export default router;


