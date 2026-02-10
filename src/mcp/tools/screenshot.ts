/**
 * browser_screenshot tool - capture page or element screenshots
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import { takeScreenshotViaPlaywright } from "../../browser/pw-tools-interactions.js";

const SCREENSHOTS_DIR = join(homedir(), ".ultimate-playwright-mcp", "screenshots");

export function registerBrowserScreenshotTool(
  register: RegisterToolFn,
  config: ServerConfig
) {
  register(
    "browser_screenshot",
    "Take a screenshot of the current page or a specific element. " +
    "By default saves to file and returns the path (saves context window tokens). " +
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
        returnAs: {
          type: "string",
          enum: ["file", "base64"],
          description:
            "How to return the screenshot. 'file' (default) saves to disk and returns the file path — " +
            "dramatically reduces context window usage. 'base64' returns inline image data (legacy behavior).",
        },
        savePath: {
          type: "string",
          description:
            "Custom file path to save the screenshot to (only used when returnAs is 'file'). " +
            "If not provided, saves to ~/.ultimate-playwright-mcp/screenshots/ with a timestamp filename.",
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
      returnAs?: "file" | "base64";
      savePath?: string;
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

      const ext = args.type === "jpeg" ? "jpg" : "png";
      const mimeType = args.type === "jpeg" ? "image/jpeg" : "image/png";
      const returnAs = args.returnAs ?? "file";

      if (returnAs === "file") {
        // Save to disk, return path + metadata
        const filePath = args.savePath ?? generateScreenshotPath(ext);
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, buffer);
        const sizeKB = Math.round(buffer.length / 1024);

        return `Screenshot saved: ${filePath} (${sizeKB}KB, ${mimeType})`;
      }

      // Legacy: return inline base64
      const base64 = buffer.toString("base64");
      return {
        __image: true,
        mimeType,
        base64,
      };
    }
  );
}

function generateScreenshotPath(ext: string): string {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(SCREENSHOTS_DIR, `screenshot-${ts}.${ext}`);
}
