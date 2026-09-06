import cron from "node-cron";
import { env } from "../config/env.js";

interface Job {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
}

const jobs: Job[] = [];

export function registerJob(job: Job) {
  jobs.push(job);
}

export function startJobs() {
  console.log("Starting worker jobs...");

  for (const job of jobs) {
    cron.schedule(job.schedule, async () => {
      console.log(`Running job: ${job.name}`);
      try {
        await job.handler();
        console.log(`Job completed: ${job.name}`);
      } catch (error) {
        console.error(`Job failed: ${job.name}`, error);
      }
    });
    console.log(`Scheduled job: ${job.name} with schedule: ${job.schedule}`);
  }

  console.log("All jobs scheduled");
}

registerJob({
  name: "health-check",
  schedule: env.CRON_SCHEDULE,
  handler: async () => {
    console.log("Health check job running...");
  },
});

registerJob({
  name: "agent-run",
  schedule: env.CRON_SCHEDULE,
  handler: async () => {
    console.log("Agent run job placeholder - Phase 1.1 bootstrap");
  },
});