import { defineConfig } from "vitest/config";

// Shared vitest configuration for the monorepo
// Individual packages can extend this or define their own
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/**/types.ts",
      ],
    },
  },
});
