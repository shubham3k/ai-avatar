import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "src/renderer",
  // Packaged builds load index.html via file:// (BrowserWindow.loadFile),
  // not a web server — an absolute base ("/assets/...", Vite's default)
  // resolves against the filesystem root under file://, so the JS/CSS
  // 404 and the page never boots past a blank #root. Relative asset paths
  // work under both file:// and the dev server.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
