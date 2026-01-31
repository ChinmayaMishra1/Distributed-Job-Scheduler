import { redisClient } from "../queue/redisClient.js";
import { Job } from "../models/Job.js";
import { PCB } from "../models/PCB.js";
import { PriorityAging } from "./PriorityAging.js";

/**
 * PCB Manager - Handles context switching and preemption
 * Similar to OS scheduler
 */
export class PCBManager {
  constructor() {
    this.priorityOrder = {
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    };
  }

  /**
   * Check if current job should be preempted
   * Returns true if a higher priority job (considering aging) is waiting
   */
  async checkPreemption(currentJob) {
    // Get effective priority of current job (including age boost if suspended)
    const currentEffectivePriority = PriorityAging.getEffectivePriority(currentJob);

    // Find highest priority job waiting in any queue
    let highestWaitingPriority = 0;
    for (let priority = 10; priority >= 1; priority--) {
      const count = await redisClient.lLen(`jobQueue:${priority}`);
      if (count > 0) {
        highestWaitingPriority = priority;
        break;
      }
    }

    // If a higher priority job is waiting, preempt
    if (highestWaitingPriority > currentEffectivePriority) {
      console.log(
        `[Preemption Check] Current job effective priority: ${currentEffectivePriority}, ` +
        `Highest waiting priority: ${highestWaitingPriority} → PREEMPT`
      );
      return true;
    }

    return false;
  }

  /**
   * Get PCB for a job
   */
  async getPCB(jobId) {
    let pcb = await PCB.findOne({ jobId });
    if (!pcb) {
      pcb = await PCB.create({
        jobId,
        status: "READY",
      });
    }
    return pcb;
  }

  /**
   * Save job context/state
   */
  async saveContext(jobId, context) {
    const pcb = await this.getPCB(jobId);
    pcb.executionContext = context;
    pcb.elapsedTime = Date.now() - pcb.startTime;
    await pcb.save();
    return pcb;
  }

  /**
   * Resume job from suspended state
   */
  async resumeJob(jobId) {
    const pcb = await PCB.findOne({ jobId });
    if (!pcb) return null;

    pcb.status = "READY";
    pcb.resumeCount = (pcb.resumeCount || 0) + 1;
    await pcb.save();

    return pcb;
  }

  /**
   * Get job statistics including PCB info and time requirements
   */
  async getJobStats(jobId) {
    const pcb = await PCB.findOne({ jobId });
    if (!pcb) return null;

    const remainingTime = Math.max(0, pcb.expectedDuration - pcb.elapsedTime);
    const timeUntilDeadline = Math.max(0, pcb.deadlineTime - Date.now());

    return {
      jobId,
      pcbStatus: pcb.status,
      elapsedTime: pcb.elapsedTime,
      expectedDuration: pcb.expectedDuration,
      remainingTime: remainingTime,
      deadlineTime: pcb.deadlineTime,
      timeUntilDeadline: timeUntilDeadline,
      resumeCount: pcb.resumeCount,
      startTime: pcb.startTime,
      preemptedBy: pcb.preemptedBy,
      delayProgress: pcb.delayProgress,
    };
  }

  /**
   * Get all suspended jobs (ready to be resumed later)
   */
  async getSuspendedJobs() {
    return PCB.find({ status: "SUSPENDED" }).populate("jobId");
  }

  /**
   * Print PCB queue status (like 'ps' command in OS)
   */
  async printQueueStatus() {
    const runningJobs = await PCB.find({ status: "RUNNING" }).populate(
      "jobId",
      "type priority"
    );
    const suspendedJobs = await PCB.find({ status: "SUSPENDED" }).populate(
      "jobId",
      "type priority"
    );

    console.log("\n========== PCB QUEUE STATUS ==========");
    console.log("RUNNING:");
    runningJobs.forEach((pcb) => {
      const remainingTime = Math.max(0, pcb.expectedDuration - pcb.elapsedTime);
      console.log(
        `  - Job ${pcb.jobId._id} (${pcb.jobId.type}) [Priority: ${pcb.jobId.priority}]\n` +
        `    Elapsed: ${pcb.elapsedTime}ms / Expected: ${pcb.expectedDuration}ms | Remaining: ${remainingTime}ms`
      );
    });

    console.log("\nSUSPENDED (Preempted):");
    suspendedJobs.forEach((pcb) => {
      const remainingTime = Math.max(0, pcb.expectedDuration - pcb.elapsedTime);
      console.log(
        `  - Job ${pcb.jobId._id} (${pcb.jobId.type}) [Priority: ${pcb.jobId.priority}]\n` +
        `    Elapsed: ${pcb.elapsedTime}ms / Expected: ${pcb.expectedDuration}ms | Remaining: ${remainingTime}ms | Resumes: ${pcb.resumeCount}`
      );
    });
    console.log("=====================================\n");
  }
}
