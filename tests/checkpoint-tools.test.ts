import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DISABLED_COLLECTORS = {
  screenshot: false,
  html: false,
  axe: false,
  "web-vitals": false,
  console: false,
  network: false,
  metadata: false,
  "aria-snapshot": false,
  "dom-stats": false,
  forms: false,
  storage: false,
  "network-timing": false,
} as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("checkpoint capture integration", () => {
  it("captures a checkpoint against the resolved target tab and writes a manifest", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "upmcp-checkpoints-"));

    vi.doMock("../src/browser/pw-session.js", () => ({
      getPageForTargetId: vi.fn(async ({ targetId }: { targetId?: string }) => ({
        url: () => `https://example.com/${targetId ?? "default"}`,
        title: async () => "Checkpoint Page",
        waitForLoadState: vi.fn(async () => {}),
      })),
    }));

    const { captureCheckpointViaPlaywright } = await import(
      "../src/browser/pw-tools-checkpoint.js"
    );

    const result = await captureCheckpointViaPlaywright({
      cdpUrl: "http://localhost:9223",
      targetId: "target-42",
      name: "After Login",
      collectors: DISABLED_COLLECTORS,
      outputDir,
      agentId: "agent-a",
    });

    expect(result.record.name).toBe("After Login");
    expect(result.record.url).toBe("https://example.com/target-42");
    expect(result.record.title).toBe("Checkpoint Page");
    expect(result.targetId).toBe("target-42");
    expect(result.runDir).toContain(join("agent-a", "target-42"));

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf-8")) as {
      checkpoints: Array<{ name: string; url: string }>;
    };

    expect(manifest.checkpoints).toHaveLength(1);
    expect(manifest.checkpoints[0]).toMatchObject({
      name: "After Login",
      url: "https://example.com/target-42",
    });

    rmSync(outputDir, { recursive: true, force: true });
  });
});

describe("checkpoint report integration", () => {
  it("generates a report from stored checkpoint manifests", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "upmcp-report-root-"));
    const resultsDir = join(rootDir, "runs");
    const manifestDir = join(resultsDir, "default-agent", "default-tab", "2026-04-06", "run-1");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "checkpoint-manifest.json"),
      `${JSON.stringify(
        {
          environment: "mcp",
          project: "ultimate-playwright-mcp",
          testId: "default-tab",
          title: "Smoke Run",
          tags: ["mcp"],
          startedAt: "2026-04-06T00:00:00.000Z",
          checkpoints: [
            {
              name: "Homepage",
              slug: "homepage",
              url: "https://example.com",
              title: "Example Domain",
              timestamp: "2026-04-06T00:00:01.000Z",
              collectors: {},
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const { generateCheckpointReport } = await import(
      "../src/browser/pw-tools-checkpoint.js"
    );

    const result = await generateCheckpointReport({
      outputDir: rootDir,
      format: "html",
    });

    expect(result.resultsDir).toBe(resultsDir);
    expect(result.results.html.files.length).toBeGreaterThan(0);
    expect(result.results.html.files.some((file) => file.endsWith(".html"))).toBe(true);

    rmSync(rootDir, { recursive: true, force: true });
  });
});
