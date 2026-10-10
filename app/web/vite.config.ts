import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The UI calls the API with relative paths, so the bundle is identical in every
// environment. In dev, Vite proxies those paths to the server on :8000.
const API_PATHS = ["/api", "/version", "/healthz", "/readyz"];

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Served under /assets/*; that prefix is reserved so no short code can shadow it.
    assetsDir: "assets",
  },
  server: {
    proxy: Object.fromEntries(API_PATHS.map((path) => [path, "http://localhost:8000"])),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
