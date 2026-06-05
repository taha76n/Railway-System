import {
  ConflictError,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from "../utils/error.js";
import { generateAndStoreOtp, verifyOtp } from "../utils/otp.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/auth.js";
// const notificationProducer = require('../kafka/producer/notification.producer')
import bcrypt from "bcrypt";
import { redis } from "../configs/redis.js";
import { config } from "../configs/index.js";
import { logger } from "../configs/logger.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import {OAuth2Client} from "google-auth-library";
import mongoose from "mongoose";
import { AuthProvider } from "../models/authProvider.model.js";
import notificationProducer from "../kafka/producer/notification.producer.js";
const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

const sendOtp = async (firstName, lastName, email, password) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new UnauthorizedError("User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const meta = { firstName, lastName, email, hashedPassword };
  const { otp, otpSessionId } = await generateAndStoreOtp(meta);
  await notificationProducer.sendOtp(email, otp, (config.OTP_TTL) / 60);
  logger.info(`OTP email queued for : ${email}`);
  return { otp, otpSessionId };
};

const verifyOTP = async (otp, otpSession) => {

  const meta = await verifyOtp(otp, otpSession);

  if(meta === null){
    throw new BadRequestError("Invalid or expired OTP", "OTP_INVALID");
}
  
  console.log(meta.firstName, meta.lastName, meta.email, meta.hashedPassword);

  const user = await User.create({
    firstName: meta.firstName,
    lastName: meta.lastName,
    email: meta.email,
    password: meta.hashedPassword,
    emailVerified: true,
  });

  
  notificationProducer.welcomeEmail(meta.email, meta.firstName)
  logger.info(`Welcome email queued for ${meta.email}`);

  return user;
};

const login = async (email, password, deviceId) => {
  const existingUser = await User.findOne({ email });

  if (!existingUser) {
    throw new BadRequestError("Invalid Credentials");
  }

  const doesPasswordMatch = await bcrypt.compare(password, existingUser.password);

  if (!doesPasswordMatch) {
    throw new BadRequestError("Invalid Credentials");
  }

  const accessToken = generateAccessToken(existingUser.id);
  const refreshToken = generateRefreshToken(existingUser.id);
  const { jti } = jwt.decode(refreshToken);

  const { password: _password, ...safeUser } = existingUser;

  await redis.set(
    `refresh:${existingUser.id}:${deviceId}`,
    jti,
    "EX",
    config.REFRESH_TOKEN_EXP_SEC
  );

  await redis.set(
    `user:${existingUser.id}`,
    JSON.stringify(safeUser),
    "EX",
    config.REDIS_USER_TTL
  );

  return { accessToken, refreshToken, loggedInUser: safeUser };
};

const rotateRefreshToken = async (refreshToken, deviceId) => {
   const payload = verifyRefreshToken(refreshToken);
   const {id: userId, jti} = payload;
   const storedJti = await redis.get(`refresh:${userId}:${deviceId}`);
   if(!storedJti){
    throw new ForbiddenError("Session Expired", "Login AGAIN");
   };

   if (storedJti !== jti) {
    await redis.del(`refresh:${userId}:${deviceId}`);
    throw new ForbiddenError("Refresh token reused", "Login Again");
   };

   const newAccessToken = generateAccessToken(userId);
   const newRefreshToken = generateRefreshToken(userId);

   const { jti: newJti } = jwt.decode(newRefreshToken);
   await redis.set(`refresh:${userId}:${deviceId}`,newJti, "EX", config.REFRESH_TOKEN_EXP_SEC);
   return {newAccessToken, newRefreshToken}
}

const verifyGoogleIdToken = async (idToken, deviceId) => {
  // 1. Verify the token with Google
  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();

  if (!payload.sub || !payload.email) {
    throw new UnauthorizedError("Invalid Google token Payload");
  }

  // 2. Normalize the Google data to match our database schemas
  const googleUser = {
    provider: "google", // Hardcoded to match your Mongoose enum ["google"]
    providerId: payload.sub, // The unique Google account ID
    email: payload.email,
    firstName: payload.given_name,
    lastName: payload.family_name,
    emailVerified: payload.email_verified || false 
  };

  // 3. Initialize the database transaction workspace
  const session = await mongoose.startSession();
  
  // We declare 'user' here so we can access the final result outside the transaction
  let user;

  try {
    /* ===============================================================
      START OF TRANSACTION BLOCK
      Everything inside here is "All or Nothing". If any error is 
      thrown, MongoDB will instantly undo all database changes.
      ===============================================================
    */
    user = await session.withTransaction(async () => {
      
      // SCENARIO 1: The user has logged in with this Google account before.
      // We check the AuthProvider collection for their Google ID.
      const existingAuth = await AuthProvider.findOne({
        provider: googleUser.provider,
        providerId: googleUser.providerId
      })
      .populate("UserId") // Automatically fetch the linked User document
      .session(session);  // IMPORTANT: Tell this query to run INSIDE the transaction

      if (existingAuth) {
        // If found, existingAuth.UserId contains the fully populated User document.
        // Returning it immediately commits the transaction and exits the block.
        return existingAuth.UserId; 
      }

      // SCENARIO 2: A Google account was not found. Do they have an existing Email/Password account?
      // We search the User collection for their email address.
      const existingUser = await User.findOne({
        email: googleUser.email
      }).session(session); // Again, attach the query to the transaction

      if (existingUser) {
        // We found an account! We need to link this new Google login to their old account.
        // We wrap the data in an array [{...}] because we are passing the { session } options object.
        await AuthProvider.create([{
          provider: googleUser.provider,
          providerId: googleUser.providerId,
          UserId: existingUser._id // Link to the user we just found
        }], { session });

        // Commits the transaction and exits, returning the found user.
        return existingUser;
      }

      // SCENARIO 3: Complete Newcomer. No Google record, no matching email.
      // We must create a brand new User document first.
      // We MUST use 'await' here, otherwise Mongoose returns a Promise, not the data.
      const [newUser] = await User.create([{
        email: googleUser.email,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName, // Fixed typo from 'lastname'
        emailVerified: googleUser.emailVerified
      }], { session });

      // Now that the User exists, we create the AuthProvider to store their Google ID.
      // If this step fails, the transaction will automatically DELETE the 'newUser' we just made.
      await AuthProvider.create([{
        provider: googleUser.provider,
        providerId: googleUser.providerId,
        UserId: newUser._id // Link to the newly created user
      }], { session });
      
      // Commits the transaction and returns our brand new user.
      return newUser; 
      
    });
    /* =================== END OF TRANSACTION BLOCK =================== */

  } catch (error) {
    // If anything inside the transaction failed, or if MongoDB rolled back the data,
    // the error is caught here. You should handle or re-throw it.
    console.error("Authentication Transaction Failed:", error);
    throw new Error("Failed to process Google Authentication");
  } finally {
    // 4. Cleanup
    // Regardless of success or failure, we MUST close the session to free up database memory.
    await session.endSession(); 
  }

  // 5. Post-Transaction Logic (Generating Tokens)
  // We use the 'user' variable returned by the transaction block above.
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  const { jti } = jwt.decode(refreshToken);

  // Store the refresh token ID in Redis for device management
  await redis.set(`refresh:${user._id}:${deviceId}`, jti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
  
  // 6. Data Sanitization
  // Mongoose documents contain hidden internal states. To safely destructure and 
  // remove the password, we must convert it to a plain JavaScript object first.
  const plainUserObject = user.toObject ? user.toObject() : user;
  const { password: _password, ...safeUser } = plainUserObject;

  // Cache the safe user profile in Redis
  await redis.set(`user:${user._id}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
  
  logger.info(`Access Token: ${accessToken}`)
  // Send the final response back to the controller
  return { accessToken, refreshToken, loggedInUser: safeUser };
};

export const authService = { sendOtp, verifyOTP, login, rotateRefreshToken, verifyGoogleIdToken };
