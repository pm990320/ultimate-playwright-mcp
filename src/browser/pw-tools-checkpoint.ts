import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  CheckpointConfig,
  CheckpointManifest,
  CheckpointRecord,
  CheckpointOptions,
  ReportGenerationResults,
} from "playwright-checkpoint";
import { createCheckpointSession, runReporters } from "playwright-checkpoint";
import type { Page as CheckpointPage } from "@playwright/test";
import { getPageForTargetId } from "./pw-session.js";

const DEFAULT_CHECKPOINT_ROOT = join(
  homedir(),
  ".ultimate-playwright-mcp",
  "checkpoints",
);

type BrowserCheckpointCollectors = NonNullable<CheckpointOptions["collectors"]>;

export type BrowserCheckpointCaptureResult = {
  record: CheckpointRecord;
  manifest: CheckpointManifest;
  manifestPath: string;
  runDir: string;
  rootDir: string;
  resultsDir: string;
  targetId?: string;
};

export type BrowserCheckpointReportResult = {
  results: ReportGenerationResults;
  resultsDir: string;
  outputDir: string;
  rootDir: string;
};

export function getCheckpointRootDir(configuredDir?: string): string {
  const value = String(configuredDir ?? "").trim();
  if (!value) {
    return DEFAULT_CHECKPOINT_ROOT;
  }
  return isAbsolute(value) ? value : resolve(value);
}

export function getCheckpointResultsDir(rootDir: string): string {
  return join(rootDir, "runs");
}

export function getCheckpointReportDir(rootDir: string): string {
  return join(rootDir, "report");
}

export function sanitizeCheckpointPathSegment(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = String(value ?? "").trim().toLowerCase();
  const sanitized = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function isoTimestampSegment(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function ensureUniqueDirectory(baseDir: string, name: string): string {
  mkdirSync(baseDir, { recursive: true });
  let candidate = join(baseDir, name);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(baseDir, `${name}-${suffix}`);
    suffix += 1;
  }
  mkdirSync(candidate, { recursive: true });
  return candidate;
}

export function buildCheckpointRunPaths(args: {
  rootDir: string;
  name: string;
  targetId?: string;
  agentId?: string;
  now?: Date;
}): {
  rootDir: string;
  resultsDir: string;
  reportDir: string;
  runDir: string;
  manifestPath: string;
} {
  const rootDir = getCheckpointRootDir(args.rootDir);
  const resultsDir = getCheckpointResultsDir(rootDir);
  const reportDir = getCheckpointReportDir(rootDir);
  const agentSegment = sanitizeCheckpointPathSegment(args.agentId, "default-agent");
  const targetSegment = sanitizeCheckpointPathSegment(args.targetId, "default-tab");
  const daySegment = (args.now ?? new Date()).toISOString().slice(0, 10);
  const runName = `${isoTimestampSegment(args.now)}-${sanitizeCheckpointPathSegment(
    args.name,
    "checkpoint",
  )}`;
  const runDir = ensureUniqueDirectory(
    join(resultsDir, agentSegment, targetSegment, daySegment),
    runName,
  );

  return {
    rootDir,
    resultsDir,
    reportDir,
    runDir,
    manifestPath: join(runDir, "checkpoint-manifest.json"),
  };
}

function buildSessionMetadata(args: {
  name: string;
  targetId?: string;
  agentId?: string;
  startedAt: string;
}): Partial<CheckpointManifest> {
  const targetId = args.targetId?.trim();
  const agentId = args.agentId?.trim();

  return {
    environment: "mcp",
    project: agentId || "ultimate-playwright-mcp",
    testId: targetId || "default-tab",
    title: args.name,
    tags: [
      "mcp",
      ...(agentId ? [`agent:${agentId}`] : []),
      ...(targetId ? [`target:${targetId}`] : []),
      `started:${args.startedAt}`,
    ],
  };
}

export function collectArtifactPaths(record: CheckpointRecord): string[] {
  const paths = new Set<string>();
  for (const result of Object.values(record.collectors)) {
    for (const artifact of result.artifacts) {
      paths.add(artifact.path);
    }
  }
  return [...paths];
}

export function formatCheckpointCaptureResult(
  result: BrowserCheckpointCaptureResult,
): string {
  const lines = [
    `Checkpoint captured: ${result.record.name}`,
    ...(result.targetId ? [`Target: ${result.targetId}`] : []),
    `URL: ${result.record.url}`,
    `Title: ${result.record.title || "(untitled)"}`,
    `Run dir: ${result.runDir}`,
    `Manifest: ${result.manifestPath}`,
  ];

  const artifactPaths = collectArtifactPaths(result.record);
  if (artifactPaths.length === 0) {
    lines.push("Artifacts: none");
  } else {
    lines.push("Artifacts:");
    for (const artifactPath of artifactPaths) {
      lines.push(`- ${artifactPath}`);
    }
  }

  return lines.join("\n");
}

export function formatCheckpointReportResult(
  result: BrowserCheckpointReportResult,
): string {
  const lines = [
    `Checkpoint reports generated from ${result.resultsDir}`,
    `Output dir: ${result.outputDir}`,
  ];

  const formats = Object.entries(result.results);
  if (formats.length === 0) {
    lines.push("No reports generated.");
    return lines.join("\n");
  }

  for (const [name, reportResult] of formats) {
    lines.push(`${name}: ${reportResult.summary}`);
    for (const file of reportResult.files) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n");
}

export async function captureCheckpointViaPlaywright(args: {
  cdpUrl: string;
  name: string;
  targetId?: string;
  description?: string;
  highlightSelector?: string;
  fullPage?: boolean;
  collectors?: BrowserCheckpointCollectors;
  outputDir?: string;
  agentId?: string;
}): Promise<BrowserCheckpointCaptureResult> {
  const page = (await getPageForTargetId({
    cdpUrl: args.cdpUrl,
    targetId: args.targetId,
  })) as unknown as CheckpointPage;

  const startedAt = new Date().toISOString();
  const paths = buildCheckpointRunPaths({
    rootDir: getCheckpointRootDir(args.outputDir),
    name: args.name,
    targetId: args.targetId,
    agentId: args.agentId,
  });

  const session = await createCheckpointSession(page, {
    outputDir: paths.runDir,
    manifestPath: paths.manifestPath,
    collectors: args.collectors,
    sessionMetadata: buildSessionMetadata({
      name: args.name,
      targetId: args.targetId,
      agentId: args.agentId,
      startedAt,
    }),
  });

  try {
    const record = await session.checkpoint(args.name, {
      description: args.description,
      highlightSelector: args.highlightSelector,
      fullPage: args.fullPage,
    });
    const manifest = await session.finalize();
    return {
      record,
      manifest,
      manifestPath: paths.manifestPath,
      runDir: paths.runDir,
      rootDir: paths.rootDir,
      resultsDir: paths.resultsDir,
      targetId: args.targetId,
    };
  } catch (error) {
    await session.finalize().catch(() => {});
    throw error;
  }
}

export async function generateCheckpointReport(args: {
  outputDir?: string;
  resultsDir?: string;
  format?: "html" | "markdown" | "mdx";
}): Promise<BrowserCheckpointReportResult> {
  const rootDir = getCheckpointRootDir(args.outputDir);
  const resultsDir = args.resultsDir
    ? (isAbsolute(args.resultsDir) ? args.resultsDir : resolve(args.resultsDir))
    : getCheckpointResultsDir(rootDir);
  const reportDir = getCheckpointReportDir(rootDir);

  mkdirSync(reportDir, { recursive: true });

  const config: CheckpointConfig = args.format
    ? {
        reporters: {
          html: args.format === "html",
          markdown: args.format === "markdown",
          mdx: args.format === "mdx",
        },
      }
    : {};

  const results = await runReporters(config, resultsDir, reportDir);
  return {
    results,
    resultsDir,
    outputDir: reportDir,
    rootDir,
  };
}
