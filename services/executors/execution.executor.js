import { PCB } from "../../models/PCB.js";

/**
 * Pure execution executor (delay already happened in background)
 * Only handles the actual work phase with preemption support
 */
export async function executionOnlyExecutor(job, pcbManager) {
  let pcb = await PCB.findOne({ jobId: job._id });
  
  if (!pcb) {
    // First execution - create new PCB
    pcb = await PCB.create({
      jobId: job._id,
      status: "RUNNING",
      startTime: new Date(),
      elapsedTime: 0,
      expectedDuration: job.executionTimeSecs * 1000, // Convert to ms
      deadlineTime: new Date(Date.now() + (job.executionTimeSecs * 1000)),
      executionTimeSecs: job.executionTimeSecs,
      executionTimeDoneSecs: 0,
    });
  } else if (pcb.status === "SUSPENDED") {
    // Resuming from suspension
    pcb.status = "RUNNING";
    pcb.resumeCount += 1;
    console.log(
      `[PCB] Resuming job ${job._id} (Resume: ${pcb.resumeCount}, Already executed: ${pcb.executionTimeDoneSecs}s)`
    );
  }

  const totalExecutionMs = job.executionTimeSecs * 1000;
  const alreadyExecutedMs = pcb.executionTimeDoneSecs * 1000;
  const remainingMs = totalExecutionMs - alreadyExecutedMs;

  console.log(
    `[Execution Phase] Total needed: ${totalExecutionMs}ms | Already done: ${alreadyExecutedMs}ms | Remaining: ${remainingMs}ms`
  );

  const PREEMPTION_CHECK_INTERVAL = 100; // Check every 100ms
  let executedSoFar = 0;

  while (executedSoFar < remainingMs) {
    const chunkMs = Math.min(PREEMPTION_CHECK_INTERVAL, remainingMs - executedSoFar);

    // Sleep for this chunk
    await new Promise((resolve) => setTimeout(resolve, chunkMs));
    executedSoFar += chunkMs;

    // Check if we should be preempted
    const shouldPreempt = await pcbManager.checkPreemption(job, job.priority);
    
    if (shouldPreempt) {
      // Save progress and suspend
      pcb.status = "SUSPENDED";
      pcb.executionTimeDoneSecs = (alreadyExecutedMs + executedSoFar) / 1000;
      pcb.suspendedAt = new Date();
      await pcb.save();

      job.status = "SUSPENDED";
      await job.save();

      console.log(
        `[⚠️ PREEMPTED] Job ${job._id} suspended after ${executedSoFar}ms execution`
      );
      return; // Exit - will be resumed later
    }
  }

  // Execution complete
  pcb.status = "COMPLETED";
  pcb.executionTimeDoneSecs = job.executionTimeSecs;
  await pcb.save();

  console.log(
    `[✅ Execution Complete] Job ${job._id} finished in ${totalExecutionMs}ms`
  );
}
