// handlers/jobFailure.handler.js

import { Job } from "../models/Job.js";
import { redisClient } from "../queue/redisClient.js";

// Named export MUST match import in worker
export async function handleJobFailure(job, error) {

  job.retries += 1;
  job.lastError = error.message;

  // Retry allowed
  if (job.retries <= job.maxRetries) {
    job.status = "PENDING";
    await job.save();

    // Push job back to retry queue
    await redisClient.lPush(
      "retryQueue",
      job._id.toString()
    );

    console.log(
      `Retrying job ${job._id} (${job.retries}/${job.maxRetries})`
    );

  } else {
    // Retries exhausted → move to DLQ
    job.status = "FAILED";
    await job.save();

    await redisClient.lPush(
      "deadLetterQueue",
      job._id.toString()
    );

    console.error(
      `Job moved to DLQ: ${job._id}`
    );
  }
}
