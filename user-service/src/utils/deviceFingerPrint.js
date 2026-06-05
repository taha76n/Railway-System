import crypto from "node:crypto";

export const getDeviceFingerPrint = (req) => {
  const userAgent = req.headers["user-agent"] || "";
  const ip = req.ip || "";
  const accept = req.headers["accept"] || "";

  const raw = `${userAgent}|${ip}|${accept}`;

  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
};
