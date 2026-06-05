import jwt from "jsonwebtoken";
import { config } from "../configs/index.js";
import crypto from "node:crypto";


const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const generateAccessToken = (userId) => {
  const payload = {
    id: userId
  };

  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {expiresIn: config.ACCESS_TOKEN_EXP});

}

const generateRefreshToken = (userId) => {
  const payload = {
    id: userId,
    jti: crypto.randomUUID()
  };

  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {expiresIn: config.REFRESH_TOKEN_EXP});

}


const verifyAccessToken = (accessToken) => {
  console.log("➡️ VERIFY FUNCTION CALLED");
  console.log("SECRET USED:", process.env.JWT_ACCESS_SECRET);

  return jwt.verify(accessToken, config.JWT_ACCESS_SECRET);

}


const verifyRefreshToken = (refreshToken) => {

  return jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);

}

export {
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
}