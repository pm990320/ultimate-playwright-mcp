/**
 * browser_tabs tool - manage browser tabs with targetId-based isolation and tab group support
 */

import type { ServerConfig } from "../../config.js";
import {
  listPagesViaPlaywright,
  createPageViaPlaywright,
  closePageByTargetIdViaPlaywright,
  focusPageByTargetIdViaPlaywright,
} from "../../browser/pw-session.js";
import {
  addTabToGroup,
  removeTabFromGroup,
  getTabsInGroup,
  getGroupForTab,
  getTabGroup,
  pruneStaleTargets,
  setChromeGroupId,
  getChromeTabId,
} from "../../browser/tab-groups.js";
import {
  groupTabsVisually,
  isTabGrouperAvailable,
  createTabViaExtension,
  closeTabViaExtension,
} from "../../browser/chrome-tab-groups.js";

export function registerBrowserTabsTool(
  register: (name: string, description: string, schema: any, handler: (args: any) => Promise<any>) => void,
  config: ServerConfig
) {
  register(
    "browser_tabs",
    "Manage browser tabs. When using tab groups (recommended for multi-user), pass groupId to " +
    "scope operations to your group's tabs only.\n\n" +
    "Actions:\n" +
    "- 'list': Show tabs. With groupId → only your group's tabs. Without → all tabs.\n" +
    "- 'new': Create a tab. **Requires groupId** — tab is added to that group. Returns targetId.\n" +
    "- 'close': Close a tab by index or targetId.\n" +
    "- 'select': Focus a tab by index or targetId.\n\n" +
    "⚡ IMPORTANT: Always create a tab group first with browser_tab_group, then use the groupId here.",
    {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "new", "close", "select"],
          description: "Tab action to perform",
        },
        groupId: {
          type: "string",
          description: "Tab group ID to scope this operation to (from browser_tab_group). " +
            "Recommended for multi-user isolation.",
        },
        url: {
          type: "string",
          description: "URL for 'new' action (defaults to about:blank)",
        },
        index: {
          type: "number",
          description: "Tab index for 'close' or 'select' actions (relative to group if groupId is set)",
        },
        targetId: {
          type: "string",
          description: "Target ID for 'close' or 'select' actions (alternative to index)",
        },
      },
      required: ["action"],
    },
    async (args: {
      action: string;
      groupId?: string;
      url?: string;
      index?: number;
      targetId?: string;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const { action, groupId, url, index, targetId } = args;

      // Helper: get tabs scoped to group (or all tabs)
      async function getScopedTabs() {
        const allTabs = await listPagesViaPlaywright({ cdpUrl: config.cdpEndpoint! });

        // Prune stale entries from registry
        const liveIds = new Set(allTabs.map((t) => t.targetId));
        pruneStaleTargets(liveIds);

        if (!groupId) {
          return allTabs;
        }

        // Validate group exists
        const group = getTabGroup(groupId);
        if (!group) {
          throw new Error(
            `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
          );
        }

        const groupTargetIds = new Set(getTabsInGroup(groupId));
        return allTabs.filter((t) => groupTargetIds.has(t.targetId));
      }

      // Helper: resolve target from index or targetId, respecting group scope
      async function resolveTarget(
        scopedTabs: Array<{ targetId: string; title: string; url: string }>,
      ): Promise<string> {
        if (targetId) {
          // If groupId set, verify this tab belongs to the group
          if (groupId) {
            const tabGroup = getGroupForTab(targetId);
            if (tabGroup !== groupId) {
              throw new Error(
                `Tab ${targetId} does not belong to group ${groupId}.`,
              );
            }
          }
          return targetId;
        }
        if (typeof index === "number") {
          const tab = scopedTabs[index];
          if (!tab) {
            throw new Error(
              `No tab at index ${index}` +
                (groupId ? ` in group ${groupId}` : ""),
            );
          }
          return tab.targetId;
        }
        throw new Error("Either 'index' or 'targetId' is required");
      }

      switch (action) {
        case "list": {
          const tabs = await getScopedTabs();
          if (tabs.length === 0) {
            if (groupId) {
              return `**No tabs in group ${groupId}.**\nCreate one with browser_tabs({ action: 'new', groupId: '${groupId}', url: '...' })`;
            }
            return "**No tabs open.**";
          }

          const output = tabs
            .map((tab, i) => {
              const groupLabel = !groupId ? (() => {
                const g = getGroupForTab(tab.targetId);
                const info = g ? getTabGroup(g) : null;
                return info ? ` [${info.name}]` : " [ungrouped]";
              })() : "";
              return (
                `[${i}] **targetId: ${tab.targetId}**${groupLabel}\n` +
                `    ${tab.title || "(no title)"}\n` +
                `    ${tab.url}`
              );
            })
            .join("\n\n");

          const label = groupId ? `in group ${groupId}` : "total";
          return `**${tabs.length} tab(s)** ${label}\n\n${output}`;
        }

        case "new": {
          // groupId is required for creating tabs
          if (!groupId) {
            throw new Error(
              "groupId is required when creating new tabs. " +
              "Create a tab group first with browser_tab_group, then pass the groupId here.",
            );
          }

          const group = getTabGroup(groupId);
          if (!group) {
            throw new Error(
              `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
            );
          }

          const tabUrl = url || "about:blank";
          let resultTargetId: string;
          let chromeTabId: number | undefined;

          // Prefer creating via extension (gives us Chrome tab ID directly for reliable grouping)
          const hasExtension = await isTabGrouperAvailable(config.cdpEndpoint!);
          if (hasExtension) {
            try {
              const extTab = await createTabViaExtension(config.cdpEndpoint!, tabUrl);
              resultTargetId = extTab.targetId;
              chromeTabId = extTab.chromeTabId;
            } catch {
              // Fall back to Playwright
              const pwTab = await createPageViaPlaywright({
                cdpUrl: config.cdpEndpoint,
                url: tabUrl,
              });
              resultTargetId = pwTab.targetId;
            }
          } else {
            const pwTab = await createPageViaPlaywright({
              cdpUrl: config.cdpEndpoint,
              url: tabUrl,
            });
            resultTargetId = pwTab.targetId;
          }

          // Associate with group in registry (include Chrome tab ID if available)
          addTabToGroup(resultTargetId, groupId, chromeTabId);

          // Add to Chrome visual group
          if (chromeTabId !== undefined) {
            try {
              const color = group.color || "grey";
              const result = await groupTabsVisually(
                config.cdpEndpoint!,
                [chromeTabId],
                group.name,
                color,
                group.chromeGroupId,
              );
              if (!group.chromeGroupId) {
                setChromeGroupId(groupId, result.groupId);
              }
            } catch {
              // Visual grouping is best-effort
            }
          }

          return (
            `**Tab created**\n` +
            `**targetId: ${resultTargetId}** ← Use this with other browser tools\n` +
            `Group: ${groupId}\n` +
            `URL: ${tabUrl}`
          );
        }

        case "close": {
          const tabs = await getScopedTabs();
          const tid = await resolveTarget(tabs);

          // Get stored Chrome tab ID for clean closure
          const storedChromeTabId = getChromeTabId(tid);

          // Close the tab — prefer extension if we have the Chrome tab ID
          if (storedChromeTabId !== undefined) {
            try {
              await closeTabViaExtension(config.cdpEndpoint!, storedChromeTabId);
            } catch {
              // Fall back to Playwright
              await closePageByTargetIdViaPlaywright({
                cdpUrl: config.cdpEndpoint,
                targetId: tid,
              });
            }
          } else {
            await closePageByTargetIdViaPlaywright({
              cdpUrl: config.cdpEndpoint,
              targetId: tid,
            });
          }

          // Remove from registry
          removeTabFromGroup(tid);

          return `**Tab closed:** ${tid}`;
        }

        case "select": {
          const tabs = await getScopedTabs();
          const tid = await resolveTarget(tabs);

          await focusPageByTargetIdViaPlaywright({
            cdpUrl: config.cdpEndpoint,
            targetId: tid,
          });

          return `**Tab focused:** ${tid}`;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }
  );
}
