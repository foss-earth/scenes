import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,mjs}"],
    environment: "node",
    setupFiles: [],
    maxWorkers: "50%",
    forceRerunTriggers: ["styles/**", "schema/**", "src/**", "scripts/**", "node/**", "tests/fixtures/**", "fixtures/composition/**"],
  },
});
