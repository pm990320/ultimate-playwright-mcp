/**
 * Browser action tools - click, type, hover, etc.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  clickViaPlaywright,
  typeViaPlaywright,
  hoverViaPlaywright,
  pressKeyViaPlaywright,
  fillFormViaPlaywright,
  waitForViaPlaywright,
  type BrowserFormField,
} from "../../browser/pw-tools-interactions.js";

export function registerBrowserActionTools(
  register: RegisterToolFn,
  config: ServerConfig
) {
  // browser_click
  register(
    "browser_click",
    "Click an element by its ref (e1, e2, etc. from snapshot)",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot (e.g., 'e1', 'e2')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button to click (default: left)",
        },
        doubleClick: {
          type: "boolean",
          description: "Perform a double-click",
        },
      },
      required: ["ref"],
    },
    async (args: { ref: string; targetId?: string; button?: "left" | "right" | "middle"; doubleClick?: boolean }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await clickViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        button: args.button,
        doubleClick: args.doubleClick,
      });

      return `**Clicked** element ${args.ref}`;
    }
  );

  // browser_type
  register(
    "browser_type",
    "Type text into an element",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        submit: {
          type: "boolean",
          description: "Press Enter after typing",
        },
      },
      required: ["ref", "text"],
    },
    async (args: { ref: string; text: string; targetId?: string; submit?: boolean }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await typeViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        text: args.text,
        submit: args.submit,
      });

      return `**Typed** "${args.text}" into ${args.ref}`;
    }
  );

  // browser_hover
  register(
    "browser_hover",
    "Hover over an element",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["ref"],
    },
    async (args: { ref: string; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await hoverViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
      });

      return `**Hovered** over ${args.ref}`;
    }
  );

  // browser_press_key
  register(
    "browser_press_key",
    "Press a keyboard key",
    {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to press (e.g., 'Enter', 'Escape', 'ArrowDown')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["key"],
    },
    async (args: { key: string; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await pressKeyViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        key: args.key,
      });

      return `**Pressed** key: ${args.key}`;
    }
  );

  // browser_fill_form
  register(
    "browser_fill_form",
    "Fill multiple form fields at once",
    {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "Array of form fields to fill",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              type: { type: "string" },
              value: { type: ["string", "number", "boolean"] },
            },
            required: ["ref", "type"],
          },
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["fields"],
    },
    async (args: { fields: BrowserFormField[]; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await fillFormViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        fields: args.fields,
      });

      return `**Filled** ${args.fields.length} form field(s)`;
    }
  );

  // browser_wait_for
  register(
    "browser_wait_for",
    "Wait for a condition (text, selector, load state, time, etc.)",
    {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Wait for text to appear on page",
        },
        textGone: {
          type: "string",
          description: "Wait for text to disappear from page",
        },
        selector: {
          type: "string",
          description: "Wait for CSS selector",
        },
        url: {
          type: "string",
          description: "Wait for URL to match pattern",
        },
        loadState: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "Wait for load state",
        },
        timeMs: {
          type: "number",
          description: "Wait for specific milliseconds",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
    },
    async (args: {
      text?: string;
      textGone?: string;
      selector?: string;
      url?: string;
      loadState?: "load" | "domcontentloaded" | "networkidle";
      timeMs?: number;
      targetId?: string;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await waitForViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        text: args.text,
        textGone: args.textGone,
        selector: args.selector,
        url: args.url,
        loadState: args.loadState,
        timeMs: args.timeMs,
      });

      const conditions = [
        args.text && `text: "${args.text}"`,
        args.textGone && `text gone: "${args.textGone}"`,
        args.selector && `selector: ${args.selector}`,
        args.url && `URL: ${args.url}`,
        args.loadState && `load state: ${args.loadState}`,
        args.timeMs && `${args.timeMs}ms`,
      ].filter(Boolean);

      return `**Wait completed** for ${conditions.join(", ")}`;
    }
  );
}
