import { PCB } from "../../models/PCB.js";

/**
 * Interruptible delay executor with context switching support
 * Can be suspended if higher priority job arrives
 */
export async function delayExecutorWithContextSwitch(job, pcbManager) {
  let pcb = await PCB.findOne({ jobId: job._id });
  
  if (!pcb) {
    // First execution - create new PCB
    pcb = await PCB.create({
      jobId: job._id,
      status: "RUNNING",
      startTime: new Date(),
      elapsedTime: 0,
      expectedDuration: job.payload.delayMs,
      deadlineTime: new Date(Date.now() + job.payload.delayMs),
      executionTimeSecs: job.executionTimeSecs, // Time needed to operate
      executionTimeDoneSecs: 0,
      delayProgress: {
        totalDelayMs: job.payload.delayMs,
        delayedSoFarMs: 0,
      },
    });
  } else if (pcb.status === "SUSPENDED") {
    // Resuming from suspension
    pcb.status = "RUNNING";
    pcb.resumeCount += 1;
    console.log(
      `[PCB] Resuming job ${job._id} (Resume count: ${pcb.resumeCount}, Already executed: ${pcb.delayProgress.delayedSoFarMs}ms)`
    );
  }

  const totalDelay = pcb.delayProgress.totalDelayMs;
  const alreadyDelayed = pcb.delayProgress.delayedSoFarMs; // How much delay execution already done
  const remainingDelay = totalDelay - alreadyDelayed;

  console.log(
    `[Delay Phase] Total: ${totalDelay}ms | Execution time done: ${alreadyDelayed}ms | Remaining to execute: ${remainingDelay}ms`
  );

  const PREEMPTION_CHECK_INTERVAL = 100; // Check every 100ms for higher priority
  let delayedSoFar = 0;

  while (delayedSoFar < remainingDelay) {
    // 🛑 Check if we've exceeded max execution time (shouldn't happen now)
    const currentDelayTime = alreadyDelayed + delayedSoFar;

    // Check if we should be preempted
    const shouldPreempt = await pcbManager.checkPreemption(job);

    if (shouldPreempt) {
      console.log(
        `[PCB] Job ${job._id} PREEMPTED by higher priority job - SUSPENDING`
      );

      // Update PCB with current progress
      // Save only the EXECUTION time spent in this session (not wall-clock)
      pcb.status = "SUSPENDED";
      pcb.delayProgress.delayedSoFarMs = alreadyDelayed + delayedSoFar; // Add actual execution time
      pcb.suspendedAt = new Date();
      await pcb.save();

      throw new Error("PREEMPTED"); // Signal preemption
    }

    // Sleep in small increments
    const sleepTime = Math.min(PREEMPTION_CHECK_INTERVAL, remainingDelay - delayedSoFar);
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
    delayedSoFar += sleepTime;

    // Update PCB periodically
    if (delayedSoFar % 500 === 0) {
      // Track actual execution time spent
      pcb.elapsedTime = alreadyDelayed + delayedSoFar;
      await pcb.save();
    }
  }

  // Mark as complete
  pcb.status = "COMPLETED";
  // Track total delay time spent
  pcb.elapsedTime = totalDelay;
  await pcb.save();

  console.log(`[Delay] Delay completed! Total delay time: ${totalDelay}ms`);

  // 🔥 NOW EXECUTION PHASE - Time needed to operate
  console.log(`\n[Execution Phase] Starting execution phase - ${pcb.executionTimeSecs}s execution time needed`);
  
  const executionTimeNeededMs = (pcb.executionTimeSecs || 10) * 1000;
  const executionTimeDoneMs = (pcb.executionTimeDoneSecs || 0) * 1000;
  const remainingExecutionMs = executionTimeNeededMs - executionTimeDoneMs;

  console.log(
    `[Execution] Total needed: ${executionTimeNeededMs}ms | Already done: ${executionTimeDoneMs}ms | Remaining: ${remainingExecutionMs}ms`
  );

  let executionDoneSoFar = 0;

  while (executionDoneSoFar < remainingExecutionMs) {
    // 🛑 Check preemption during execution phase too
    const shouldPreempt = await pcbManager.checkPreemption(job);

    if (shouldPreempt) {
      console.log(
        `[Execution] Job ${job._id} PREEMPTED during execution phase - SUSPENDING`
      );

      pcb.status = "SUSPENDED";
      pcb.executionTimeDoneSecs = (executionTimeDoneMs + executionDoneSoFar) / 1000; // Save in seconds
      pcb.suspendedAt = new Date();
      await pcb.save();

      throw new Error("PREEMPTED");
    }

    // Execute in small chunks
    const execChunk = Math.min(100, remainingExecutionMs - executionDoneSoFar);
    await new Promise((resolve) => setTimeout(resolve, execChunk));
    executionDoneSoFar += execChunk;

    // Periodic update
    if (executionDoneSoFar % 500 === 0) {
      pcb.executionTimeDoneSecs = (executionTimeDoneMs + executionDoneSoFar) / 1000;
      await pcb.save();
    }
  }

  // Execution complete
  pcb.status = "COMPLETED";
  pcb.executionTimeDoneSecs = pcb.executionTimeNeededSecs;
  await pcb.save();

  console.log(`[Execution] Execution phase completed! Total: ${executionTimeNeededMs}ms`);
  console.log(`✅ [Job Complete] Delay + Execution finished successfully!`);
}
