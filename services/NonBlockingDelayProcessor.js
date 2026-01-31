import { redisClient } from "../queue/redisClient.js";
import { Job } from "../models/Job.js";

/**
 * Processes job delays WITHOUT blocking workers
 * Delays are done in background, then job moves to priority queue when ready
 */
export class NonBlockingDelayProcessor {
  /**
   * Check which jobs are ready (delay expired)
   * Move them to their priority queues
   */
  static async promoteReadyJobs() {
    try {
      // Get all job IDs from pending queue (all priorities combined)
      const allPendingJobIds = new Set();
      
      for (let priority = 1; priority <= 10; priority++) {
        const queueKey = `jobQueue:${priority}`;
        const jobs = await redisClient.lRange(queueKey, 0, -1);
        jobs.forEach(jobId => allPendingJobIds.add(jobId));
      }

      // Also check jobs that haven't been queued yet (in MongoDB as PENDING)
      const pendingJobs = await Job.find({ 
        status: "PENDING"
      }).select("_id createdAt delayMs");

      for (const pendingJob of pendingJobs) {
        const createdTime = pendingJob.createdAt.getTime();
        const currentTime = Date.now();
        const elapsedMs = currentTime - createdTime;
        const delayMs = pendingJob.delayMs || 0;

        // Is this job ready?
        if (elapsedMs >= delayMs) {
          // Job is ready! Move to priority queue
          const job = await Job.findById(pendingJob._id);
          const priority = Math.min(job.priority || 5, 10);
          
          await redisClient.lPush(`jobQueue:${priority}`, pendingJob._id.toString());
          
          // Update job status to READY
          job.status = "READY";
          await job.save();

          console.log(
            `[Delay→Ready] Job ${pendingJob._id.toString().slice(0, 8)} ready! ` +
            `Delayed ${elapsedMs}ms, pushed to jobQueue:${priority}`
          );
        }
      }

      // Check jobs already in queues
      for (const jobId of allPendingJobIds) {
        const job = await Job.findById(jobId);
        if (!job) continue;
        
        if (job.status === "PENDING") {
          const createdTime = job.createdAt.getTime();
          const currentTime = Date.now();
          const elapsedMs = currentTime - createdTime;
          const delayMs = job.delayMs || 0;

          if (elapsedMs >= delayMs) {
            job.status = "READY";
            await job.save();
          }
        }
      }
    } catch (error) {
      console.error("[NonBlockingDelayProcessor] Error:", error.message);
    }
  }

  /**
   * Check how much longer a job needs to wait
   */
  static getTimeUntilReady(job) {
    const createdTime = job.createdAt.getTime();
    const currentTime = Date.now();
    const elapsedMs = currentTime - createdTime;
    const delayMs = job.delayMs || 0;
    
    const remainingMs = delayMs - elapsedMs;
    return Math.max(0, remainingMs);
  }

  /**
   * Get count of jobs still in delay phase
   */
  static async getDelayedJobsCount() {
    const delayedJobs = await Job.countDocuments({ status: "PENDING" });
    return delayedJobs;
  }

  /**
   * Print status of delayed jobs
   */
  static async printDelayedJobsStatus() {
    try {
      const delayedJobs = await Job.find({ status: "PENDING" })
        .select("_id createdAt delayMs priority")
        .limit(5);

      if (delayedJobs.length === 0) return;

      console.log("\n[Delayed Jobs Status]");
      for (const job of delayedJobs) {
        const remaining = this.getTimeUntilReady(job);
        console.log(
          `  Job ${job._id.toString().slice(0, 8)}: ` +
          `${remaining}ms remaining (priority ${job.priority})`
        );
      }
      console.log("");
    } catch (error) {
      console.error("[DelayedJobsStatus] Error:", error.message);
    }
  }
}
