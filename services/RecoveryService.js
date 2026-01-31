import { Job } from "../models/Job.js";
import { PCB } from "../models/PCB.js";
import { redisClient } from "../queue/redisClient.js";

/**
 * Recovery Service
 * Handles job recovery on worker startup
 * Re-queues unfinished jobs that were lost during crashes
 */
export class RecoveryService {
  /**
   * Recover unfinished jobs on startup
   */
  static async recoverJobs() {
    console.log("🔄 [Recovery] Starting job recovery...");

    try {
      // 1️⃣ Find all PENDING jobs (never started)
      const pendingJobs = await Job.find({ status: "PENDING" });
      console.log(`[Recovery] Found ${pendingJobs.length} PENDING jobs`);

      for (const job of pendingJobs) {
        // Re-queue to priority queue
        await redisClient.lPush(`jobQueue:${job.priority}`, job._id.toString());
        console.log(`[Recovery] Re-queued PENDING job ${job._id} (priority: ${job.priority})`);
      }

      // 2️⃣ Find all RUNNING jobs (interrupted by crash)
      const runningJobs = await Job.find({ status: "RUNNING" });
      console.log(`[Recovery] Found ${runningJobs.length} RUNNING jobs (interrupted)`);

      for (const job of runningJobs) {
        // Reset to PENDING so they can be reprocessed
        job.status = "PENDING";
        await job.save();

        // Re-queue to priority queue
        await redisClient.lPush(`jobQueue:${job.priority}`, job._id.toString());
        console.log(`[Recovery] Reset and re-queued RUNNING job ${job._id} (priority: ${job.priority})`);
      }

      // 3️⃣ Find all SUSPENDED jobs (preempted but not resumed before crash)
      const suspendedPCBs = await PCB.find({ status: "SUSPENDED" }).populate("jobId");
      console.log(`[Recovery] Found ${suspendedPCBs.length} SUSPENDED jobs`);

      for (const pcb of suspendedPCBs) {
        const job = pcb.jobId;
        
        // Reset PCB to READY
        pcb.status = "READY";
        await pcb.save();

        // Re-queue the suspended job
        await redisClient.lPush(`jobQueue:${job.priority}`, job._id.toString());
        console.log(
          `[Recovery] Re-queued SUSPENDED job ${job._id} (priority: ${job.priority}, resume count: ${pcb.resumeCount})`
        );
      }

      console.log(
        `✅ [Recovery] Recovery complete! Re-queued ${pendingJobs.length + runningJobs.length + suspendedPCBs.length} jobs`
      );
    } catch (err) {
      console.error("❌ [Recovery] Recovery failed:", err);
    }
  }

  /**
   * Print recovery stats
   */
  static async printRecoveryStats() {
    const pending = await Job.countDocuments({ status: "PENDING" });
    const running = await Job.countDocuments({ status: "RUNNING" });
    const suspended = await PCB.countDocuments({ status: "SUSPENDED" });
    const completed = await Job.countDocuments({ status: "SUCCESS" });
    const failed = await Job.countDocuments({ status: "FAILED" });

    console.log("\n========== RECOVERY STATS ==========");
    console.log(`PENDING:    ${pending}`);
    console.log(`RUNNING:    ${running}`);
    console.log(`SUSPENDED:  ${suspended}`);
    console.log(`COMPLETED:  ${completed}`);
    console.log(`FAILED:     ${failed}`);
    console.log("===================================\n");
  }
}
