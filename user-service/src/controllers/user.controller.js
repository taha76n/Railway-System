import { logger } from "../configs/logger.js";
import { redis } from "../configs/redis.js";
import { User } from "../models/user.model.js";
import { userService } from "../services/user.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getDeviceFingerPrint } from "../utils/deviceFingerPrint.js";
import { BadRequestError } from "../utils/error.js";

const getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  if (!userId) {
    throw new BadRequestError("User Id is missing");
  }

  const userProfile = await userService.getProfile(userId);

  res.status(200).json({
    succes: true,
    message: "Fetched user successfully",
    data: userProfile,
  });
});

const updateprofile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { firstName, lastName } = req.body;

  if (!userId) {
    throw new BadRequestError("User id is missing");
  }

  const updatedUser = await userService.updateProfile(
    userId,
    firstName,
    lastName
  );

  res.status(200).json({
    success: true,
    message: "user profile updated successfully",
    data: updatedUser,
  });
});

const deleteUserAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  if (!userId) {
    throw new BadRequestError("User id is missing");
  }

  const deviceId = getDeviceFingerPrint(req);

  await userService.deleteUserAccount(userId, deviceId);

  res.status(200).json({
    success: true,
    message: "user deleted successfully",
  });
});

const getUserInternal = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  if (!userId) {
    throw new BadRequestError("User id is missing");
  }

  const user = await userService.getProfile(userId);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  res.status(200).json({
    success: true,
    data: {
      user
    },
  });
});

export const userController = {
  getProfile,
  getUserInternal,
  updateprofile,
  deleteUserAccount,
};
