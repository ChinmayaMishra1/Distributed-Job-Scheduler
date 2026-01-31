import { executionOnlyExecutor } from "./executors/execution.executor.js";
import { emailExecutor } from "./executors/email.executor.js";
import { webhookExecutor } from "./executors/webhook.executor.js";

export async function executeJob(job, pcbManager) {
  switch (job.type) {
    case "DELAY":
      return executionOnlyExecutor(job, pcbManager);

    case "EMAIL":
      return executionOnlyExecutor(job, pcbManager);

    case "WEBHOOK":
      return executionOnlyExecutor(job, pcbManager);

    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}
