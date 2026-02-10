/**
 * browser_tab_group tool — manage tab groups for multi-user isolation.
 *
 * Each session should create a tab group first, then use the group name
 * with browser_tabs and other tools to stay isolated.
 *
 * State is stored in the companion extension's chrome.storage.local —
 * no external JSON files. The extension is the source of truth.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  createTabGroup,
  listTabGroups,
  deleteTabGroup,
} from "../../browser/tab-groups.js";
import {
  listPagesViaPlaywright,
  closePageByTargetIdViaPlaywright,
} from "../../browser/pw-session.js";
import {
  isTabGrouperAvailable,
} from "../../browser/chrome-tab-groups.js";

export function registerBrowserTabGroupTool(
  register: RegisterToolFn,
  config: ServerConfig,
) {
  register(
    "browser_tab_group",
    "Manage tab groups for session isolation. Multiple users/agents sharing one browser " +
      "MUST create a tab group first, then pass the groupId to browser_tabs and other tools. " +
      "This ensures each session only sees and controls its own tabs.\n\n" +
      "Actions:\n" +
      "- 'create': Create a new tab group. Returns a groupId to use with all other browser tools.\n" +
      "- 'list': List all tab groups with tab counts.\n" +
      "- 'delete': Delete a tab group and optionally close its tabs.\n\n" +
      "⚡ IMPORTANT: Always create a tab group before opening tabs with browser_tabs.",
    {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "delete"],
          description: "Tab group action to perform",
        },
        name: {
          type: "string",
          description: "Human-readable name for the group (for 'create' action)",
        },
        color: {
          type: "string",
          enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"],
          description: "Visual color for the group (for 'create' action)",
        },
        groupId: {
          type: "string",
          description: "Group name (for 'delete' action)",
        },
        closeTabs: {
          type: "boolean",
          description:
            "Whether to close all tabs in the group when deleting (default: true)",
        },
      },
      required: ["action"],
    },
    async (args: {
      action: string;
      name?: string;
      color?: string;
      groupId?: string;
      closeTabs?: boolean;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const { action } = args;

      // Require extension for all tab group operations
      const hasExtension = await isTabGrouperAvailable(config.cdpEndpoint);
      if (!hasExtension) {
        throw new Error(
          "Tab Grouper extension not found. Tab groups require the companion extension.\n" +
            "It should auto-load with the Chrome daemon. Check daemon logs.",
        );
      }

      switch (action) {
        case "create": {
          if (!args.name) {
            throw new Error("'name' is required for create action");
          }
          const result = await createTabGroup(config.cdpEndpoint, {
            name: args.name,
            color: args.color,
          });

          const status = result.created
            ? "**Tab group created**"
            : "**Tab group already exists** (reusing)";

          return (
            `${status}\n` +
            `**groupId: ${result.name}** ← Use this with browser_tabs and other tools\n` +
            `Color: ${result.color}\n` +
            `Next step: Use browser_tabs with groupId="${result.name}" to create tabs in this group.`
          );
        }

        case "list": {
          // Prune stale targets
          try {
            const { pruneStaleTargets } = await import("../../browser/tab-groups.js");
            const liveTabs = await listPagesViaPlaywright({
              cdpUrl: config.cdpEndpoint,
            });
            const liveIds = liveTabs.map((t) => t.targetId);
            await pruneStaleTargets(config.cdpEndpoint, liveIds);
          } catch {
            // Best-effort
          }

          const groups = await listTabGroups(config.cdpEndpoint);
          if (groups.length === 0) {
            return "**No tab groups exist.**\nCreate one with browser_tab_group({ action: 'create', name: '...' })";
          }

          const output = groups
            .map((g) => {
              return (
                `• **${g.name}**\n` +
                `  Tabs: ${g.tabCount} | Color: ${g.color} | Chrome group: ${g.chromeGroupId ?? "none"} | Created: ${new Date(g.createdAt).toISOString()}`
              );
            })
            .join("\n\n");
          return `**${groups.length} tab group(s)**\n\n${output}`;
        }

        case "delete": {
          // Accept groupId (which is now just the name)
          const name = args.groupId;
          if (!name) {
            throw new Error("'groupId' (group name) is required for delete action");
          }
          const closeTabs = args.closeTabs !== false;

          const { removed, ungroupedTargetIds } = await deleteTabGroup(
            config.cdpEndpoint,
            name,
          );

          if (!removed) {
            return `**Tab group not found:** ${name}`;
          }

          if (closeTabs && ungroupedTargetIds.length > 0) {
            const closeResults: string[] = [];
            for (const targetId of ungroupedTargetIds) {
              try {
                await closePageByTargetIdViaPlaywright({
                  cdpUrl: config.cdpEndpoint,
                  targetId,
                });
                closeResults.push(`  ✓ Closed ${targetId}`);
              } catch {
                closeResults.push(
                  `  ✗ Could not close ${targetId} (may already be closed)`,
                );
              }
            }
            return (
              `**Tab group deleted:** ${name}\n` +
              `**${ungroupedTargetIds.length} tab(s) removed:**\n` +
              closeResults.join("\n")
            );
          }

          return (
            `**Tab group deleted:** ${name}\n` +
            `Tabs removed: ${ungroupedTargetIds.length}` +
            (!closeTabs && ungroupedTargetIds.length > 0
              ? " (tabs left open in browser)"
              : "")
          );
        }

        default:
          throw new Error(
            `Unknown action: ${action}. Use 'create', 'list', or 'delete'.`,
          );
      }
    },
  );
}
