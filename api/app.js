import express from "express";
import mongoose from "mongoose";
import { config } from "../config/env.js";
import dashboardRoutes from "./routes/dashboard.js";

// 🔑 This import ensures Redis connects when API starts
import "../queue/redisClient.js";   

const app = express();

app.use(express.json());
app.set("view engine", "ejs");

app.get("/", (req, res) => {
  res.send("Job Scheduler API is running");
});

app.use("/dashboard", dashboardRoutes);


// MongoDB connection
mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log("MongoDB connected successfully");
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
  });

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
