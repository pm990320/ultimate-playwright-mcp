import { defineConfig } from "vitest/config";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Create a temp dir for tests BEFORE any test file loads
const testDataDir = mkdtempSync(join(tmpdir(), "upmcp-test-"));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    env: {
      UPMCP_DATA_DIR: testDataDir,
    },
  },
});
