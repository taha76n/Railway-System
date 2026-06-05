import { TooManyRequestsError }  from "./error.js";
import {config}  from '../configs/index.js';
import {redis} from "../configs/redis.js"
import otpGenerator  from 'otp-generator';
import crypto  from 'crypto';
import { log } from "console";

const RATE_MAX = parseInt(config.OTP_RATE_MAX_PER_HOUR || '5', 10);
const ATTEMPT_MAX = parseInt(config.OTP_MAX_VERIFY_ATTEMPTS || '5', 10);
const OTP_TTL = parseInt(config.OTP_TTL || '300', 10);
const HMAC_SECRET = config.OTP_HMAC_SECRET;


const hmacFor = (otp, email) => {
  return crypto.createHmac("sha256", HMAC_SECRET).update(email + ":" + otp).digest("hex");
}

const generateAndStoreOtp = async(meta) => {
  const rateKey = `otp:rate${meta.email}`;
  const setCount = parseInt(redis.get(rateKey) || "0", 10);

  if (setCount >= RATE_MAX) {
    throw new TooManyRequestsError(
      "Too many OTP requests. Try again later.",
               "OTP_RATE_LIMIT"
    )
  }

  const otp = otpGenerator.generate(6,{
    upperCaseAlphabets:false,
    lowerCaseAlphabets: false,
    specialChars:false
  });

  console.log(otp);
  

  const otpSessionId = crypto.randomUUID();
  // console.log(otpSessionId);
  
  const hashed = hmacFor(otp, meta.email);

  await redis.set(`otp:session:${otpSessionId}`, JSON.stringify({
    hashedOtp: hashed,
    meta
  }), "EX", OTP_TTL)

  await redis.incr(rateKey);
  await redis.expire(rateKey, 3600);
  // console.log("OTP:", otp);
console.log("HASH:", hashed);
  return {otp, otpSessionId}
}

const verifyOtp = async(otp, otpSessionId) => {
  const rawData = await redis.get(`otp:session:${otpSessionId}`);

  if(!rawData){
    return null;
  };

  const {hashedOtp: storedOtp, meta} = JSON.parse(rawData);

  const attemptsKey = `otp:attempts:${meta.email}`;

  console.log(meta.firstName, meta.lastName, meta.email, meta.hashedPassword);


  const attemptsCount = parseInt(await redis.get(attemptsKey) || "0", 10);

  if (attemptsCount >= ATTEMPT_MAX) {
    throw new TooManyRequestsError(
      "Too many attempts to verify OTP"
    )
  }

  const hashedOtp = hmacFor(otp, meta.email);
  console.log("OTP entered:", otp);
console.log("HASH computed:", hashedOtp);
console.log("HASH stored:", storedOtp);
  
  

  if (crypto.timingSafeEqual(Buffer.from(hashedOtp, "hex"),Buffer.from(storedOtp, "hex"))) {
    await redis.del(`otp:session:${otpSessionId}`, attemptsKey);
    await redis.del(`otp:rate:${meta.email}`);
    return meta;
  }else{
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, OTP_TTL)
    return null;
  }

}

export {generateAndStoreOtp, verifyOtp}