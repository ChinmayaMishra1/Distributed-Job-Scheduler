import { Job } from "../models/Job.js";

/**
 * Priority Aging Service
 * Increases job priority over time to prevent starvation
 * Priority increases by 1 every second, max 10
 */
export class PriorityAging {
  /**
   * Boost priority of jobs waiting in queue
   * Called periodically to age pending jobs
   * NOTE: Only age READY and SUSPENDED jobs
   * Do NOT age PENDING jobs (they're blocked by delay, not waiting in queue)
   * Do NOT age RUNNING jobs (already executing)
   */
  static async ageJobs() {
    try {
      // Find only READY and SUSPENDED jobs (not PENDING or RUNNING)
      const waitingJobs = await Job.find({ status: { $in: ["READY", "SUSPENDED"] } });

      for (const job of waitingJobs) {
        // Calculate age in seconds
        const ageInSeconds = Math.floor(
          (Date.now() - job.createdAt.getTime()) / 1000
        );

        // Priority increases by 1 every second, max 10
        const newPriority = Math.min(job.priority + ageInSeconds, 10);

        if (newPriority > job.priority) {
          const oldPriority = job.priority;
          job.priority = newPriority;
          await job.save();

          const status = job.status === "SUSPENDED" ? "[Suspended]" : "[Ready]";
          console.log(
            `[Aging] ${status} Job ${job._id}: priority boosted ${oldPriority} → ${newPriority} (aged ${ageInSeconds}s)`
          );
        }
      }
    } catch (err) {
      console.error("Priority aging error:", err);
    }
  }

  /**
   * Get job age in seconds
   */
  static getJobAge(job) {
    return Math.floor((Date.now() - job.createdAt.getTime()) / 1000);
  }

  /**
   * Calculate effective priority (original + age boost)
   */
  static getEffectivePriority(job) {
    // Handle old jobs that don't have priority set (before numeric priorities)
    const basePriority = job.priority || 5; // Default to 5 if undefined
    const age = this.getJobAge(job);
    return Math.min(basePriority + age, 10);
  }

  /**
   * Print aging stats for debugging
   */
  static async printAgingStats() {
    const jobs = await Job.find({ status: "PENDING" }).limit(10);

    console.log("\n========== PRIORITY AGING STATS ==========");
    jobs.forEach((job) => {
      const age = this.getJobAge(job);
      const effective = this.getEffectivePriority(job);
      const basePriority = job.priority || 5; // Default if undefined
      console.log(
        `Job ${job._id.toString().slice(-8)}: Base=${basePriority}, Age=${age}s, Effective=${effective}`
      );
    });
    console.log("=========================================\n");
  }
}
