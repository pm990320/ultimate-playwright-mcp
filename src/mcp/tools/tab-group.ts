/**
 * browser_tab_group tool — manage tab groups for multi-user isolation.
 *
 * Logical isolation should still work when the companion extension is not
 * loaded. Visual Chrome tab groups are best-effort only.
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

      switch (action) {
        case "create": {
          if (!args.name) {
            throw new Error("'name' is required for create action");
          }

          const result = createTabGroup(config.cdpEndpoint, {
            name: args.name,
            color: args.color,
          });

          const hasExtension = await isTabGrouperAvailable(config.cdpEndpoint);
          const visualNote = hasExtension
            ? "Visual grouping: available. Tabs in this logical group can also be grouped in Chrome."
            : "Visual grouping: unavailable. Logical isolation still works, but Chrome tab groups are disabled until the companion extension loads.";

          const status = result.created
            ? "**Tab group created**"
            : "**Tab group already exists** (reusing)";

          return (
            `${status}\n` +
            `**groupId: ${result.name}** ← Use this with browser_tabs and other tools\n` +
            `Color: ${result.color}\n` +
            `${visualNote}\n` +
            `Next step: Use browser_tabs with groupId="${result.name}" to create tabs in this group.`
          );
        }

        case "list": {
          try {
            const liveTabs = await listPagesViaPlaywright({
              cdpUrl: config.cdpEndpoint,
            });
            pruneStaleTargets(config.cdpEndpoint, liveTabs.map((tab) => tab.targetId));
          } catch {
            // Pruning is best-effort.
          }

          const groups = listTabGroups(config.cdpEndpoint);
          if (groups.length === 0) {
            return "**No tab groups exist.**\nCreate one with browser_tab_group({ action: 'create', name: '...' })";
          }

          let visualGroups: Array<{ id: number; title: string; color: string }> = [];
          try {
            visualGroups = await listVisualTabGroups(config.cdpEndpoint);
          } catch {
            // Extension is optional.
          }

          const output = groups
            .map((group) => {
              const visual = group.chromeGroupId
                ? visualGroups.find((candidate) => candidate.id === group.chromeGroupId)
                : null;
              const visualLabel = visual
                ? ` | Chrome group: ${visual.title} (${visual.color})`
                : "";

              return (
                `• **${group.name}**\n` +
                `  Tabs: ${group.tabCount} | Color: ${group.color} | Created: ${new Date(group.createdAt).toISOString()}${visualLabel}`
              );
            })
            .join("\n\n");

          return `**${groups.length} tab group(s)**\n\n${output}`;
        }

        case "delete": {
          const name = args.groupId;
          if (!name) {
            throw new Error("'groupId' (group name) is required for delete action");
          }

          const closeTabs = args.closeTabs !== false;
          const group = getTabGroup(config.cdpEndpoint, name);
          const { removed, ungroupedTargetIds } = deleteTabGroup(config.cdpEndpoint, name);

          if (!removed) {
            return `**Tab group not found:** ${name}`;
          }

          if (group?.chromeGroupId && ungroupedTargetIds.length > 0) {
            try {
              const liveTabs = await listPagesViaPlaywright({
                cdpUrl: config.cdpEndpoint,
              });
              const toUngroup = liveTabs.filter((tab) => ungroupedTargetIds.includes(tab.targetId));
              if (toUngroup.length > 0) {
                const mapped = await mapTargetIdsToChromeTabIds(config.cdpEndpoint, toUngroup);
                const chromeTabIds = [...mapped.values()];
                if (chromeTabIds.length > 0) {
                  await ungroupTabsVisually(config.cdpEndpoint, chromeTabIds);
                }
              }
            } catch {
              // Visual ungrouping is best-effort.
            }
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
                closeResults.push(`  ✗ Could not close ${targetId} (may already be closed)`);
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
