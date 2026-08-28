import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: resolve(import.meta.dirname, "src/renderer"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
