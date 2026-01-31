import express from "express";
import { Job } from "../../models/Job.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  const jobs = await Job.find()
    .sort({ createdAt: -1 })
    .limit(50);

  res.render("dashboard", { jobs });
});

export default router;
