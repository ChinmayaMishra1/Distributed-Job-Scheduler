import mongoose from "mongoose";
import { config } from "../config/env.js";
import { Job } from "../models/Job.js";
import { PCB } from "../models/PCB.js";

console.log("🔄 Cleaning up old jobs...");

// Connect MongoDB
await mongoose.connect(config.mongoUri);
console.log("Connected to MongoDB");

// Delete all PENDING jobs with undefined or string priority
const result = await Job.deleteMany({
  status: "PENDING",
  $or: [
    { priority: { $exists: false } },
    { priority: { $type: "string" } }
  ]
});

console.log(`✅ Deleted ${result.deletedCount} old jobs`);

// Also clean up old PCBs
const pcbResult = await PCB.deleteMany({});
console.log(`✅ Deleted ${pcbResult.deletedCount} old PCBs`);

// Close connection
await mongoose.connection.close();
console.log("✅ Cleanup complete!");
process.exit(0);
