import dotenv from "dotenv";

dotenv.config();

export const config = {
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL,
  jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || "60000"), // Default 60 seconds - only for execution, not delay
};
