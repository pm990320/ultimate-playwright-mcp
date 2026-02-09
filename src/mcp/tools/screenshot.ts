/**
 * browser_screenshot tool - capture page or element screenshots
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import { takeScreenshotViaPlaywright } from "../../browser/pw-tools-interactions.js";

export function registerBrowserScreenshotTool(
  register: RegisterToolFn,
  config: ServerConfig
) {
  register(
    "browser_screenshot",
    "Take a screenshot of the current page or a specific element. Returns a base64-encoded PNG/JPEG image. " +
    "Use `ref` to screenshot a specific element (from snapshot refs like e1, e2), or `element` for a CSS selector. " +
    "Omit both for a full page screenshot.",
    {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          description: "Target ID of the tab (from browser_tabs). If not provided, uses first available tab.",
        },
        ref: {
          type: "string",
          description: "Element reference from snapshot (e.g., 'e1', 'e2') to screenshot a specific element.",
        },
        element: {
          type: "string",
          description: "CSS selector to screenshot a specific element (alternative to ref).",
        },
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page instead of just the viewport (default: false). Not compatible with ref/element.",
        },
        type: {
          type: "string",
          enum: ["png", "jpeg"],
          description: "Image format (default: png). Use jpeg for smaller file sizes.",
        },
        quality: {
          type: "number",
          description:
            "JPEG quality (1-100). Only applies when type is 'jpeg'. Default: 80. " +
            "Lower values = smaller file size.",
        },
        maxWidth: {
          type: "number",
          description:
            "Maximum width in pixels. Image will be scaled down proportionally if wider. " +
            "Reduces base64 size for large/full-page screenshots.",
        },
      },
    },
    async (args: {
      targetId?: string;
      ref?: string;
      element?: string;
      fullPage?: boolean;
      type?: "png" | "jpeg";
      quality?: number;
      maxWidth?: number;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const { buffer } = await takeScreenshotViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        element: args.element,
        fullPage: args.fullPage,
        type: args.type,
        quality: args.quality,
        maxWidth: args.maxWidth,
      });

      const base64 = buffer.toString("base64");
      const mimeType = args.type === "jpeg" ? "image/jpeg" : "image/png";

      // Return as image content for MCP clients that support it
      return {
        __image: true,
        mimeType,
        base64,
      };
    }
  );
}
