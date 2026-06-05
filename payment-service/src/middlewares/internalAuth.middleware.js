import { config } from "../configs/index.js";
import { ForbiddenError } from "../utils/error.js";

const internalAuth = (req, res, next) => {
  const serviceKey = req.headers["x-internal-service-key"];

  if (!serviceKey || serviceKey !== config.INTERNAL_SERVICE_KEY) {
    throw new ForbiddenError("Invalid or missing internal service key");
  }

  next();
};

export default internalAuth;
