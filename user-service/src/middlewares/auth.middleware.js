import { UnauthorizedError } from "../utils/error.js";
import { verifyAccessToken } from "../utils/auth.js";


export const requireAuth = (req, res, next) => {

  console.log("\n========================");
  console.log("➡️ AUTH MIDDLEWARE HIT");

  const authHeader = req.headers.authorization;
  console.log("AUTH HEADER:", authHeader);
  // const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Authorization token missing"));
  }

  
  const accessToken = authHeader.split(" ")[1];
  console.log("TOKEN RECEIVED:", accessToken);
console.log("CURRENT TIME:", Math.floor(Date.now() / 1000));
console.log("TOKEN LENGTH:", accessToken?.length);
console.log("TOKEN PARTS:", accessToken?.split(".").length);

  try {
    const decoded = verifyAccessToken(accessToken);
    if (!decoded) {
      return next(new UnauthorizedError("Invalid token "));
    }
    req.user = decoded;
    console.log("AUTH HEADER:", req.headers.authorization);

const token = req.headers.authorization?.split(" ")[1];

console.log("TOKEN:", token);

// const decoded = jwt.decode(token);

console.log("DECODED WITHOUT VERIFY:", decoded);

console.log("JWT SECRET:", process.env.JWT_ACCESS_SECRET);
    next();
  } catch (error) {
    console.log("JWT ERROR:", error);
    return next(new UnauthorizedError("Invalid or expired token"));
  }
};
