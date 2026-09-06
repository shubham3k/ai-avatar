import { env } from "./config/env.js";
import { startJobs } from "./jobs/index.js";

console.log(`Starting worker in ${env.NODE_ENV} mode`);
console.log(`Database: ${env.DATABASE_URL.replace(/\/\/.*:.*@/, "//***:***@")}`);

startJobs();

process.on("SIGINT", () => {
  console.log("Shutting down worker...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down worker...");
  process.exit(0);
});