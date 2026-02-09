/**
 * browser_tab_group tool — manage tab groups for multi-user isolation.
 *
 * Each session should create a tab group first, then use the groupId
 * with browser_tabs and other tools to stay isolated.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  createTabGroup,
  listTabGroups,
  deleteTabGroup,
  pruneStaleTargets,
  getTabGroup,
} from "../../browser/tab-groups.js";
import {
  listPagesViaPlaywright,
  closePageByTargetIdViaPlaywright,
} from "../../browser/pw-session.js";
import {
  isTabGrouperAvailable,
  ungroupTabsVisually,
  mapTargetIdsToChromeTabIds,
  listVisualTabGroups,
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
          description: "Group ID (for 'delete' action)",
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

      switch (action) {
        case "create": {
          if (!args.name) {
            throw new Error("'name' is required for create action");
          }
          const group = createTabGroup({
            name: args.name,
            color: args.color,
          });

          // Check if visual grouping is available
          let visualNote = "";
          const hasExtension = await isTabGrouperAvailable(config.cdpEndpoint);
          if (hasExtension) {
            visualNote =
              "\nVisual grouping: ✅ Tabs will appear in a Chrome tab group.";
          } else {
            visualNote =
              "\nVisual grouping: ⚠️ Companion extension not loaded. " +
              "Tabs are logically isolated but won't show as a Chrome tab group. " +
              "Load with: --chrome-extensions extensions/tab-grouper";
          }

          return (
            `**Tab group created**\n` +
            `**groupId: ${group.groupId}** ← Use this with browser_tabs and other tools\n` +
            `Name: ${group.name}\n` +
            (group.color ? `Color: ${group.color}\n` : "") +
            visualNote +
            `\nNext step: Use browser_tabs with groupId="${group.groupId}" to create tabs in this group.`
          );
        }

        case "list": {
          // Prune stale targets first
          try {
            const liveTabs = await listPagesViaPlaywright({
              cdpUrl: config.cdpEndpoint,
            });
            const liveIds = new Set(liveTabs.map((t) => t.targetId));
            pruneStaleTargets(liveIds);
          } catch {
            // Pruning is best-effort
          }

          const groups = listTabGroups();
          if (groups.length === 0) {
            return "**No tab groups exist.**\nCreate one with browser_tab_group({ action: 'create', name: '...' })";
          }

          // Check for visual groups
          let visualGroups: Array<{
            id: number;
            title: string;
            color: string;
          }> = [];
          try {
            visualGroups = await listVisualTabGroups(config.cdpEndpoint);
          } catch {
            // Extension not available
          }

          const output = groups
            .map((g) => {
              const visual = g.chromeGroupId
                ? visualGroups.find((vg) => vg.id === g.chromeGroupId)
                : null;
              const visualLabel = visual
                ? ` | Chrome group: ${visual.title} (${visual.color})`
                : "";
              return (
                `• **${g.name}** (${g.groupId})\n` +
                `  Tabs: ${g.tabCount} | Color: ${g.color || "none"} | Created: ${new Date(g.createdAt).toISOString()}${visualLabel}`
              );
            })
            .join("\n\n");
          return `**${groups.length} tab group(s)**\n\n${output}`;
        }

        case "delete": {
          if (!args.groupId) {
            throw new Error("'groupId' is required for delete action");
          }
          const closeTabs = args.closeTabs !== false; // default true

          // Before deleting, try to ungroup tabs visually
          const group = getTabGroup(args.groupId);
          const { removedTargetIds } = deleteTabGroup(args.groupId);

          if (closeTabs && removedTargetIds.length > 0) {
            // Try visual ungrouping first (before closing)
            if (group?.chromeGroupId) {
              try {
                const liveTabs = await listPagesViaPlaywright({
                  cdpUrl: config.cdpEndpoint,
                });
                const toUngroup = liveTabs.filter((t) =>
                  removedTargetIds.includes(t.targetId),
                );
                if (toUngroup.length > 0) {
                  const idMap = await mapTargetIdsToChromeTabIds(
                    config.cdpEndpoint,
                    toUngroup,
                  );
                  const chromeIds = [...idMap.values()];
                  if (chromeIds.length > 0) {
                    await ungroupTabsVisually(config.cdpEndpoint, chromeIds);
                  }
                }
              } catch {
                // Visual ungrouping is best-effort
              }
            }

            const closeResults: string[] = [];
            for (const targetId of removedTargetIds) {
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
              `**Tab group deleted:** ${args.groupId}\n` +
              `**${removedTargetIds.length} tab(s) removed:**\n` +
              closeResults.join("\n")
            );
          }

          return (
            `**Tab group deleted:** ${args.groupId}\n` +
            `Tabs removed from registry: ${removedTargetIds.length}` +
            (!closeTabs && removedTargetIds.length > 0
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
