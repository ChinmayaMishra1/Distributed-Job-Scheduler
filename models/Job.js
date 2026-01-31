import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    payload: { type: Object, required: true },
    status: {
      type: String,
      enum: ["PENDING", "READY", "RUNNING", "SUSPENDED", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    executionTimeSecs: { type: Number, default: 10 },
    delayMs: { type: Number, default: 0 },
    priority: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Job = mongoose.model("Job", jobSchema);
