import mongoose from "mongoose";

/**
 * PCB (Process Control Block) - Similar to OS process scheduling
 * Stores execution context and state for jobs
 */
const pcbSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    status: {
      type: String,
      enum: ["RUNNING", "SUSPENDED", "READY", "COMPLETED"],
      default: "READY",
    },
    // Context info
    workerId: String,
    startTime: Date,
    elapsedTime: Number, // milliseconds already spent
    
    // Job requirements & deadlines
    expectedDuration: Number, // Total time job is expected to take (e.g., delayMs for DELAY jobs)
    deadlineTime: Date, // When the job must be completed by (optional SLA)
    executionTimeSecs: Number, // Time needed to operate (not delay time)
    executionTimeDoneSecs: Number, // How much execution time already done
    
    // Job state snapshot (for resumption)
    executionContext: {
      type: Object,
      default: {},
    },
    
    // For DELAY jobs specifically
    delayProgress: {
      totalDelayMs: Number,
      delayedSoFarMs: Number, // how much delay already completed
    },
    
    // Priority preemption info
    preemptedBy: mongoose.Schema.Types.ObjectId, // which job preempted this
    suspendedAt: Date,
    resumeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const PCB = mongoose.model("PCB", pcbSchema);
