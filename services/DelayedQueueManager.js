import { redisClient } from "../queue/redisClient.js";
import { Job } from "../models/Job.js";

/**
 * Delayed Queue Manager
 * Manages jobs with delays - keeps them separate until they're ready
 * Jobs with delay = 0 are immediately ready
 * Jobs with delay > 0 wait in a delayed queue, moved to ready queue when delay expires
 */
export class DelayedQueueManager {
  /**
   * Check if job is ready to execute
   * A job is ready if its delay has passed since creation
   */
  static isJobReady(job) {
    if (job.payload.delayMs === 0 || job.payload.delayMs === undefined) {
      return true; // No delay = immediately ready
    }

    const createdTime = new Date(job.createdAt).getTime();
    const currentTime = Date.now();
    const elapsedTime = currentTime - createdTime;

    return elapsedTime >= job.payload.delayMs;
  }

  /**
   * Get time until job is ready (in ms)
   * Returns 0 if already ready
   */
  static getTimeUntilReady(job) {
    if (job.payload.delayMs === 0 || job.payload.delayMs === undefined) {
      return 0;
    }

    const createdTime = new Date(job.createdAt).getTime();
    const readyTime = createdTime + job.payload.delayMs;
    const timeRemaining = readyTime - Date.now();

    return Math.max(0, timeRemaining);
  }

  /**
   * Move ready jobs from delayed queue to ready queue
   * Called periodically to promote jobs that are now ready
   */
  static async promoteReadyJobs() {
    try {
      // Get all PENDING jobs
      const pendingJobs = await Job.find({ status: "PENDING" });

      for (const job of pendingJobs) {
        if (this.isJobReady(job)) {
          // Check if already in a ready queue
          const isInQueue = await redisClient.exists(`jobQueue:${job.priority}`);
          
          if (!isInQueue) {
            // Add to ready queue
            await redisClient.lPush(`jobQueue:${job.priority}`, job._id.toString());
            console.log(
              `[DelayQueue] Job ${job._id} is now READY (delay expired, priority: ${job.priority})`
            );
          }
        }
      }
    } catch (err) {
      console.error("DelayedQueueManager error:", err);
    }
  }

  /**
   * Print delayed jobs status
   */
  static async printDelayedJobsStatus() {
    try {
      const pendingJobs = await Job.find({ status: "PENDING" });

      const delayedJobs = pendingJobs.filter((job) => !this.isJobReady(job));
      const readyJobs = pendingJobs.filter((job) => this.isJobReady(job));

      if (delayedJobs.length > 0 || readyJobs.length > 0) {
        console.log("\n========== DELAYED QUEUE STATUS ==========");
        
        if (readyJobs.length > 0) {
          console.log("🟢 READY (can execute now):");
          readyJobs.forEach((job) => {
            console.log(`  - Job ${job._id.toString().slice(-8)}: Priority ${job.priority}`);
          });
        }

        if (delayedJobs.length > 0) {
          console.log("⏳ DELAYED (waiting for ready time):");
          delayedJobs.forEach((job) => {
            const timeLeft = this.getTimeUntilReady(job);
            const secs = (timeLeft / 1000).toFixed(1);
            console.log(
              `  - Job ${job._id.toString().slice(-8)}: Priority ${job.priority}, Ready in ${secs}s`
            );
          });
        }

        console.log("==========================================\n");
      }
    } catch (err) {
      console.error("DelayedQueueManager status error:", err);
    }
  }
}
