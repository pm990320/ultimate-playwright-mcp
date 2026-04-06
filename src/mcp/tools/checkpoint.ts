import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  captureCheckpointViaPlaywright,
  formatCheckpointCaptureResult,
  formatCheckpointReportResult,
  generateCheckpointReport,
} from "../../browser/pw-tools-checkpoint.js";

export function registerBrowserCheckpointTools(
  register: RegisterToolFn,
  config: ServerConfig,
) {
  register(
    "browser_checkpoint",
    "Capture a structured checkpoint for the current page or a specific tab. " +
      "Stores checkpoint artifacts and a manifest under the server-managed checkpoint directory.",
    {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Unique checkpoint name for this capture.",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab. If omitted, uses the first available tab.",
        },
        description: {
          type: "string",
          description: "Long-form description of what the checkpoint captures.",
        },
        highlightSelector: {
          type: "string",
          description: "CSS selector to highlight in the screenshot artifact.",
        },
        fullPage: {
          type: "boolean",
          description: "Capture a full-page screenshot when the screenshot collector runs.",
        },
        collectors: {
          type: "object",
          description:
            "Per-collector overrides. Set a collector to false to disable it or provide an options object.",
          additionalProperties: true,
        },
      },
      required: ["name"],
    },
    async (args: {
      name: string;
      targetId?: string;
      description?: string;
      highlightSelector?: string;
      fullPage?: boolean;
      collectors?: Record<string, boolean | Record<string, unknown>>;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const result = await captureCheckpointViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        name: args.name,
        targetId: args.targetId,
        description: args.description,
        highlightSelector: args.highlightSelector,
        fullPage: args.fullPage,
        collectors: args.collectors,
        outputDir: config.checkpointOutputDir,
        agentId: config.agentId,
      });

      return formatCheckpointCaptureResult(result);
    },
  );

  register(
    "browser_checkpoint_report",
    "Generate an HTML, Markdown, or MDX report from stored MCP checkpoint manifests.",
    {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["html", "markdown", "mdx"],
          description: "Single report format to generate. Defaults to html.",
        },
        resultsDir: {
          type: "string",
          description:
            "Optional directory containing checkpoint manifests. Defaults to the server-managed checkpoint results directory.",
        },
      },
    },
    async (args: {
      format?: "html" | "markdown" | "mdx";
      resultsDir?: string;
    }) => {
      const result = await generateCheckpointReport({
        outputDir: config.checkpointOutputDir,
        resultsDir: args.resultsDir,
        format: args.format,
      });

      return formatCheckpointReportResult(result);
    },
  );
}
