import express from "express";

import { combinedRateLimit, endpointRateLimit } from "../middlewares/rateLimiting.middleware.js";
import  {requireAuth } from "../middlewares/auth.middleware.js"
import { createProxy } from "../services/proxy.js";
import { config } from "../configs/index.js";

const router = express.Router();

/**
 * USER SERVICE ROUTES
 * Gateway Path: /api/users/auth/login
 * Service Path: /auth/login
**/

const userServiceProxy = createProxy("userService", config.SERVICES.USER_SERVICE_URL);

// public routes

router.post(
  "/users/auth/send-otp",
  endpointRateLimit(5, 3600000),
  userServiceProxy
);

router.post(
  "/users/auth/verify-otp",
  endpointRateLimit(10, 3600000),
  userServiceProxy
);

router.post(
  "/users/auth/login",
  endpointRateLimit(100, 900000),
  userServiceProxy
);

router.post(
  "/users/auth/google-auth",
  endpointRateLimit(10, 900000),
  userServiceProxy
);

router.post(
  "/users/auth/rotate-refresh-token",
  endpointRateLimit(20, 900000),
  userServiceProxy
);

// private routes

router.get(
  "/users/user/profile",
  requireAuth,
  combinedRateLimit(),
  userServiceProxy
);

router.delete(
  "/users/user/profile",
  requireAuth,
  combinedRateLimit(),
  userServiceProxy
);

router.patch(
  "/users/user/profile",
  requireAuth,
  combinedRateLimit(),
  userServiceProxy
);

const adminServiceProxy = createProxy("adminService", config.SERVICES.ADMIN_SERVICE_URL);

router.post("/admins/stations/station",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.get("/admins/stations/station/:stationId",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.patch("/admins/stations/station/:stationId",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.delete("/admins/stations/station/:stationId",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.post("/admins/trains/train",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.post("/admins/trains/route",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.get("/admins/trains/train",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.get("/admins/trains/train/:trainId",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

router.post("/admins/schedules/schedule",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);
router.post("/admins/schedules/schedule/:scheduleId",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);
router.get("/admins/schedules/schedule",
  requireAuth,
  combinedRateLimit(),
  adminServiceProxy
);

const searchServiceProxy = createProxy("searchService", config.SERVICES.SEARCH_SERVICE_URL);

router.get(
  '/search/trains',
  endpointRateLimit(60, 60000), // 60 requests per minute
  searchServiceProxy
);

router.get(
  '/search/autocomplete',
  endpointRateLimit(120, 60000), // 120 requests per minute
  searchServiceProxy
);

export default router;