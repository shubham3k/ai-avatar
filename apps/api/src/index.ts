import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const start = async () => {
  const app = buildApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`API server running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
