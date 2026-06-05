import express from "express";
import { safepayWebhook } from "../controllers/webhook.controller";

const router = express.Router();

router.post("/webhooks/safepay", express.raw({type: "application/json"}), safepayWebhook);

export default router;