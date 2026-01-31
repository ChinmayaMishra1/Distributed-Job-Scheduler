import mongoose from "mongoose";
import { redisClient } from "../queue/redisClient.js";
import { config } from "../config/env.js";
import { Job } from "../models/Job.js";
import { PCB } from "../models/PCB.js";
import { executeJob } from "../services/jobExecutor.js";
import { PCBManager } from "../services/PCBManager.js";
import { PriorityAging } from "../services/PriorityAging.js";
import { RecoveryService } from "../services/RecoveryService.js";
import { NonBlockingDelayProcessor } from "../services/NonBlockingDelayProcessor.js";

/* -------------------- SAFETY HELPERS -------------------- */

// Enforce execution timeout
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Job execution timeout")), ms)
    ),
  ]);
}

/* -------------------- SHUTDOWN STATE -------------------- */

let shuttingDown = false;
let activeJob = null;
const pcbManager = new PCBManager();

/* -------------------- BOOTSTRAP -------------------- */

console.log("Worker started");

// Connect MongoDB
await mongoose.connect(config.mongoUri);
console.log("Worker connected to MongoDB");

// 🔄 Recover unfinished jobs from previous crashes
await RecoveryService.recoverJobs();
await RecoveryService.printRecoveryStats();

/* -------------------- MAIN WORKER LOOP -------------------- */

async function processJobs() {
  while (!shuttingDown) {
    let jobId;
    let job;
    const startedAt = Date.now();
    const WORKER_ID = Math.random().toString(36).slice(2, 8);


    try {
      // 1️⃣ Get job with highest priority from queue (1-10)
      // Try priorities from 10 down to 1
      let result = null;
      for (let priority = 10; priority >= 1; priority--) {
        result = await redisClient.rPop(`jobQueue:${priority}`);
        if (result) {
          jobId = result;
          console.log(`[Worker ${WORKER_ID}] Picked job:`, jobId, `(priority ${priority})`);
          break;
        }
      }

      if (!result) {
        // No jobs available, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // 2️⃣ Load job from MongoDB
      job = await Job.findById(jobId);
      if (!job) {
        console.warn("Job not found, skipping:", jobId);
        continue;
      }

      activeJob = job;

      // 3️⃣ Mark job RUNNING
      job.status = "RUNNING";
      await job.save();

      // 4️⃣ Execute job (SIMULATED WORK WITH TIMEOUT)
      // await withTimeout(
      //   new Promise((resolve) => setTimeout(resolve, 10_000)), // simulate long work
      //   5_000 // timeout after 5s
      // );
      
      // Execute job with context-switching support
      await withTimeout(executeJob(job, pcbManager), config.jobTimeoutMs);

      // 5️⃣ Mark SUCCESS
      job.status = "SUCCESS";
      await job.save();

      const duration = Date.now() - startedAt;
      
      console.log(`Job completed: ${jobId} (${duration}ms)`);

      activeJob = null;
    } catch (err) {
      const duration = Date.now() - startedAt;
      console.error(`Job failed: ${jobId} (${duration}ms)`, err.message);

      if (!job) continue;

      activeJob = null;

      // Handle preemption
      if (err.message === "PREEMPTED") {
        console.log(`[PCB] Job ${jobId} was preempted - will be resumed later`);
        // Job is already suspended in PCB, just continue to next job
        continue;
      }

      // Ensure retryCount exists
      job.retryCount = job.retryCount ?? 0;
      job.retryCount += 1;

      if (job.retryCount <= job.maxRetries) {
        const delay = Math.pow(2, job.retryCount) * 1000;
        const retryAt = Date.now() + delay;

        // 🔥 Durable retry using Redis (NO setTimeout)
        await redisClient.zAdd("delayedQueue", {
          score: retryAt,
          value: jobId,
        });

        job.status = "PENDING";
        console.log(`Retry scheduled for job ${jobId} after ${delay}ms`);
      } else {
        job.status = "FAILED";
        console.log(`Job permanently failed: ${jobId}`);
      }

      await job.save();
    }
  }
}

/* -------------------- DELAYED RETRY MOVER -------------------- */

async function processDelayedRetries() {
  while (!shuttingDown) {
    try {
      const now = Date.now();

      const readyJobs = await redisClient.zRangeByScore("delayedQueue", 0, now);

      for (const jobId of readyJobs) {
        await redisClient.zRem("delayedQueue", jobId);
        
        // Get job to know its current priority
        const retryJob = await Job.findById(jobId);
        if (retryJob) {
          await redisClient.lPush(`jobQueue:${retryJob.priority}`, jobId);
          console.log(`Moved job ${jobId} from delayedQueue to jobQueue (priority ${retryJob.priority})`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      console.error("Delayed retry worker error:", err);
    }
  }
}

/* -------------------- SUSPENDED JOB RESUMPTION -------------------- */

async function processSuspendedJobs() {
  while (!shuttingDown) {
    try {
      // Find suspended jobs that are ready to resume
      const suspendedJobs = await PCB.find({ status: "SUSPENDED" }).populate(
        "jobId"
      );

      for (const pcb of suspendedJobs) {
        const job = pcb.jobId;

        // Check if priority has been boosted due to aging
        const effectivePriority = PriorityAging.getEffectivePriority(job);
        
        // If aged priority is higher than current, update and log
        if (effectivePriority > job.priority) {
          console.log(
            `[PCB] Suspended job ${job._id} priority boosted during suspension: ${job.priority} → ${effectivePriority}`
          );
          job.priority = effectivePriority;
          await job.save();
        }

        // Re-queue the suspended job back to its priority queue (use potentially boosted priority)
        await redisClient.lPush(`jobQueue:${job.priority}`, job._id.toString());
        
        // Reset PCB status to READY for next execution attempt
        pcb.status = "READY";
        await pcb.save();

        console.log(
          `[PCB] Re-queued suspended job ${job._id} for resumption (Priority: ${job.priority}, Resume attempt: ${pcb.resumeCount + 1})`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error("Suspended job processor error:", err);
    }
  }
}

/* -------------------- PRIORITY AGING PROCESS -------------------- */

async function processPriorityAging() {
  while (!shuttingDown) {
    try {
      // Age pending jobs every 1 second
      await PriorityAging.ageJobs();

      // Re-queue jobs with updated priorities
      const pendingJobs = await Job.find({ status: "PENDING" });

      for (const job of pendingJobs) {
        // Check if this job was just aged
        const effectivePriority = PriorityAging.getEffectivePriority(job);
        
        // Move to appropriate priority queue if not already there
        // (This handles jobs that were aged and now have higher priority)
        if (effectivePriority !== job.priority && effectivePriority <= 10) {
          console.log(
            `[Aging] Re-queuing job ${job._id} with boosted priority ${job.priority} → ${effectivePriority}`
          );
        }
      }

      // Stats printing disabled - no pending jobs usually
      // Only print if you need debugging info

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      console.error("Priority aging error:", err);
    }
  }
}

/* -------------------- DELAYED QUEUE PROMOTION -------------------- */

async function processDelayedQueue() {
  while (!shuttingDown) {
    try {
      // Check if any delayed jobs are now ready and promote them
      await NonBlockingDelayProcessor.promoteReadyJobs();

      // Print status occasionally
      if (Math.random() < 0.05) {
        // ~5% chance = every ~20 seconds
        await NonBlockingDelayProcessor.printDelayedJobsStatus();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      console.error("Delayed queue processor error:", err);
    }
  }
}

/* -------------------- GRACEFUL SHUTDOWN -------------------- */

async function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  shuttingDown = true;

  if (activeJob) {
    console.log(`Re-queuing active job safely: ${activeJob._id}`);

    activeJob.status = "PENDING";
    await activeJob.save();

    await redisClient.lPush("jobQueue", activeJob._id.toString());
  }

  process.exit(0);
}

process.on("SIGINT", shutdown); // Ctrl+C
process.on("SIGTERM", shutdown); // Docker / K8s

/* -------------------- START WORKERS -------------------- */

processJobs();
processDelayedRetries();
processSuspendedJobs();
processPriorityAging();
processDelayedQueue();





//NOTES
//BRPOP is atomic.
// hence no need of locks or mutexes
// hence Redis + BRPOP already guarantees safe work distribution.