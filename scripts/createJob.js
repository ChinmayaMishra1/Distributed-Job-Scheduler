import mongoose from "mongoose";
import readline from "readline";
import { Job } from "../models/Job.js";
import { config } from "../config/env.js";
import { redisClient } from "../queue/redisClient.js";

/* -------------------- READ TERMINAL INPUT -------------------- */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/* -------------------- MAIN -------------------- */

console.log("🔥 createJob script started");

// Connect MongoDB
await mongoose.connect(config.mongoUri);
console.log("MongoDB connected");

// Ask for priority
const priorityInput = await ask(
  "Enter job priority (1-10, where 1=lowest, 10=highest): "
);

const JOB_PRIORITY = parseInt(priorityInput.trim());

// Validate priority
if (isNaN(JOB_PRIORITY) || JOB_PRIORITY < 1 || JOB_PRIORITY > 10) {
  console.error("❌ Invalid priority. Use a number between 1 and 10.");
  process.exit(1);
}

// Ask for job type
const typeInput = await ask(
  "Enter job type (DELAY / EMAIL / WEBHOOK): "
);

const JOB_TYPE = typeInput.trim().toUpperCase();

// Ask for execution time needed (time to operate AFTER delay)
const execTimeInput = await ask(
  "Enter execution time needed in secs (time job needs to operate): "
);

const EXECUTION_TIME_NEEDED = parseInt(execTimeInput.trim());

if (isNaN(EXECUTION_TIME_NEEDED) || EXECUTION_TIME_NEEDED <= 0) {
  console.error("❌ Invalid execution time. Must be a positive number.");
  process.exit(1);
}

// Ask for delay time (how long until job is READY to execute)
const delayInput = await ask(
  "Enter delay time in secs before job is ready (0 for immediate): "
);

const DELAY_TIME = parseInt(delayInput.trim());

if (isNaN(DELAY_TIME) || DELAY_TIME < 0) {
  console.error("❌ Invalid delay time. Must be 0 or positive.");
  process.exit(1);
}

/* -------------------- CREATE JOB -------------------- */

// Build payload based on type
let payload;

switch (JOB_TYPE) {
  case "DELAY":
    payload = { delayMs: DELAY_TIME * 1000 };
    break;

  case "EMAIL":
    payload = { to: "test@example.com" };
    break;

  case "WEBHOOK":
    payload = { url: "https://example.com" };
    break;

  default:
    console.error("❌ Invalid job type.");
    process.exit(1);
}

const job = await Job.create({
  type: JOB_TYPE,
  payload,
  priority: JOB_PRIORITY,
  status: "PENDING",
  retryCount: 0,
  maxRetries: 3,
  executionTimeSecs: EXECUTION_TIME_NEEDED, // Time needed to operate
  delayMs: DELAY_TIME * 1000, // Delay before job is ready
});

console.log(`✅ Job created: ${job._id}`);
console.log(`   Type: ${JOB_TYPE}`);
console.log(`   Priority: ${JOB_PRIORITY}`);
console.log(`   Delay: ${DELAY_TIME}s (becomes READY at T+${DELAY_TIME}s)`);
console.log(`   Execution time needed: ${EXECUTION_TIME_NEEDED}s`);
console.log(`   Status: PENDING → (waiting ${DELAY_TIME}s) → READY → RUNNING`);

if (DELAY_TIME === 0) {
  // No delay - push immediately to queue
  await redisClient.lPush(
    `jobQueue:${JOB_PRIORITY}`,
    job._id.toString()
  );
  console.log(`✅ Job pushed to jobQueue:${JOB_PRIORITY} (no delay)`);
} else {
  // Has delay - will be promoted by NonBlockingDelayProcessor
  console.log(`⏳ Job waiting in PENDING state. Will move to queue after ${DELAY_TIME}s`);
}

// Close readline + exit
rl.close();
process.exit(0);
