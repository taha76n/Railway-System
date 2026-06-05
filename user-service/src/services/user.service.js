import { redis } from "../configs/redis.js"
import { User } from "../models/user.model.js";
import { NotFoundError } from "../utils/error.js";
import {config} from "../configs/index.js"
import { logger } from "../configs/logger.js";

const getProfile = async (userId) => {

  logger.info("First looking up in redis")
  
  const userProfile = await redis.get(`user:${userId}`);
  
  if (userProfile) {
    logger.info("Fetched from redis");
    return JSON.parse(userProfile);
  }
  
  logger.info("if user is not in redis fetch from Db");
  const userInDb = await User.findById(userId).lean();
  
  if (!userInDb) {
    throw new NotFoundError("Invalid Credentials");
  }

  const safeUser = {
    ...userInDb,
    password: undefined, 
  };
  
  logger.info("excluding password from user object");
  
  logger.info("storing user in redis for future lookups");
  await redis.set(`user:${userId}`, JSON.stringify(safeUser), "EX", config.REDIS_USER_TTL);

  return safeUser;
}

const updateProfile = async (userId, firstName, lastName) => {
  const updateData = {};
  if (firstName) {
    updateData.firstName = firstName
  }

  if (lastName) {
    updateData.lastName = lastName
  }

  const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true
  }).select("-password");

  await redis.del(`user:${userId}`);

  if (!updatedUser) {
    throw new NotFoundError("User not found");  
  }

  logger.info(`User ${userId} updated successfully`);

  return updatedUser;
}

const deleteUserAccount = async (userId, deviceId) => {
  const user = await User.findById(userId);
  
  if (!user) {
    throw new NotFoundError("User not found");  
  }
  
  logger.info(`Deleting user ${userId} and tokens from Redis`);
  
  // Redis pipeline to execute multiple deletions in a single network trip
  const pipeline = redis.pipeline();
  pipeline.del(`user:${userId}`);
  pipeline.del(`refresh:${userId}:${deviceId}`); 
  await pipeline.exec();

  // Database Cleanup
  logger.info(`Deleting user ${userId} from database`);
  await User.deleteOne({ _id: userId });

  return true; 
};


export const userService = {getProfile, deleteUserAccount, updateProfile};