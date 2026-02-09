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
      },
    },
    async (args: { targetId?: string }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const result = await snapshotRoleViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
      });

      return result.snapshot;
    }
  );
}
