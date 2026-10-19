import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the dev-server plugins (SSL, node polyfills,
// API middleware) don't load during tests.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
  },
});
