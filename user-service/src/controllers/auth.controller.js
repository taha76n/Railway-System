import { BadRequestError, UnauthorizedError } from "../utils/error.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { config } from "../configs/index.js";
import { authService } from "../services/auth.service.js";
import { getDeviceFingerPrint } from "../utils/deviceFingerPrint.js";
import { logger } from "../configs/logger.js";

const sendOtp = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword } = req.body;
  logger.info(firstName, lastName, email, password, confirmPassword);

  if (!firstName || !lastName || !email || !password || !confirmPassword) {
    throw new BadRequestError("All fields are mandatory");
  }

  if (password !== confirmPassword) {
    throw new BadRequestError("Password mismatch");
  }

  const { otp, otpSessionId } = await authService.sendOtp(
    firstName,
    lastName,
    email,
    password
  );

  console.log(otp);
 

  res
    .cookie("otp_session", otpSessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: config.OTP_TTL * 1000,
    })
    .status(200)
    .json({
      success: true,
      message: "Otp sent successfully",
      otp_code: otp,
    });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const otp = req.body.otp;

  const otpSession = req.cookies.otp_session;

  if (!otp || !otpSession) {
    throw new BadRequestError("otp or otp session is missing");
  }

  const user = await authService.verifyOTP(otp, otpSession);

  res.clearCookie("otp_session");
  res.status(201).json({
    succes: true,
    message: "User account created succcessfully",
    data: user,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new BadRequestError("Email and Password are required");
  }

  const deviceId = getDeviceFingerPrint(req);

  const { accessToken, refreshToken, logginInUser } = await authService.login(
    email,
    password,
    deviceId
  );

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: config.ACCESS_TOKEN_EXP_SEC * 1000,
  });
  res
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: config.REFRESH_TOKEN_EXP_SEC * 1000,
    })
    .status(200)
    .json({
      success: true,
      message: "Logged in successfully",
      logginInUser,
    });
});

const rotateRefreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if(!refreshToken){
    throw new UnauthorizedError("Refresh token is missing", "LOGIN AGAIN")
  }
  const deviceId = getDeviceFingerPrint(req);

  const {newAccessToken, newRefreshToken} = await authService.rotateRefreshToken(refreshToken, deviceId);

  res.cookie("accessToken", newAccessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: config.ACCESS_TOKEN_EXP_SEC * 1000,
  })
  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: config.REFRESH_TOKEN_EXP_SEC * 1000,
  }).status(200).json({
    success: true,
    message: "Access and Refresh token reissued"
  })
})

const verifyGoogleIdToken = asyncHandler(async(req,res) => {
  const {idToken} = req.body;

  if (!idToken) {
    throw new BadRequestError("Invalid Google Id Token, INVALID TOKEN")
  };

  const deviceId = getDeviceFingerPrint(req);

  const {accessToken, refreshToken, loggedInUser} = await authService.verifyGoogleIdToken(idToken, deviceId);

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: config.ACCESS_TOKEN_EXP_SEC * 1000
  })
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: config.REFRESH_TOKEN_EXP_SEC * 1000
  }).status(200).json({
    success: true,
    message: "Logged in successfully",
    loggedInUser
  })
} )

export const authController = { sendOtp, verifyOtp, login, rotateRefreshToken, verifyGoogleIdToken };
