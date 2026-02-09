/**
 * browser_snapshot tool - capture accessibility tree snapshot with element refs
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import { snapshotRoleViaPlaywright } from "../../browser/pw-tools-snapshot.js";

export function registerBrowserSnapshotTool(
  register: RegisterToolFn,
  config: ServerConfig
) {
  register(
    "browser_snapshot",
    "Capture accessibility tree snapshot of the current page. Returns element references (e1, e2, etc.) " +
    "that can be used with other browser tools like click, type, etc.",
    {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          description: "Target ID of the tab (from browser_tabs). If not provided, uses first available tab.",
        },
        maxChars: {
          type: "number",
          description:
            "Maximum characters in snapshot. Truncates with notice if exceeded. " +
            "Recommended: 5000-15000 for smaller models, omit for full snapshot.",
        },
        compact: {
          type: "boolean",
          description:
            "Remove unnamed structural elements and empty branches. " +
            "Reduces snapshot size significantly. Recommended for simpler tasks.",
        },
        interactive: {
          type: "boolean",
          description:
            "Only include interactive elements (buttons, links, inputs, etc.). " +
            "Dramatically reduces snapshot size. Best for form-filling and clicking tasks.",
        },
        maxDepth: {
          type: "number",
          description:
            "Maximum tree depth to include (0 = root only). " +
            "Use 3-5 for focused snapshots of complex pages.",
        },
      },
    },
    async (args: {
      targetId?: string;
      maxChars?: number;
      compact?: boolean;
      interactive?: boolean;
      maxDepth?: number;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const result = await snapshotRoleViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        options: {
          compact: args.compact,
          interactive: args.interactive,
          maxDepth: args.maxDepth,
        },
      });

      let snapshot = result.snapshot;
      const stats = result.stats;

      // Apply maxChars truncation
      if (
        typeof args.maxChars === "number" &&
        args.maxChars > 0 &&
        snapshot.length > args.maxChars
      ) {
        snapshot =
          snapshot.slice(0, args.maxChars) +
          `\n\n[...TRUNCATED at ${args.maxChars} chars. ` +
          `Full snapshot: ${stats.chars} chars, ${stats.refs} refs, ` +
          `${stats.interactive} interactive elements]`;
      }

      // Always prepend stats header for model awareness
      const statsHeader = `[Snapshot: ${stats.chars} chars, ${stats.refs} refs, ${stats.interactive} interactive]`;

      return statsHeader + "\n" + snapshot;
    }
  );
}
