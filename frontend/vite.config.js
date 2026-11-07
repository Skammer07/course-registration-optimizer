import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the browser talks only to the Vite server; /api and /health are
// forwarded to the backend. Cookies therefore stay same-origin (no CORS, no
// SameSite trouble). Point it elsewhere with VITE_DEV_API_TARGET.
const apiTarget = process.env.VITE_DEV_API_TARGET || "http://localhost:5000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
