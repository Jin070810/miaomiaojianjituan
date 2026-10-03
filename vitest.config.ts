import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    dir: "tests",
    environment: "node",
    clearMocks: true,
    fileParallelism: false,
    exclude: ["**/e2e/**", "**/node_modules/**"],
  },
});
