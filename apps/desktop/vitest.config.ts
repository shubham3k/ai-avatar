import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/renderer/**/*.test.{ts,tsx}", "src/main/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});