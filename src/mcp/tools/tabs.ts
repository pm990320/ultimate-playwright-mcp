/**
 * browser_tabs tool - manage browser tabs with targetId-based isolation and tab group support.
 *
 * Tab group state is stored in the companion extension — no external JSON files.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  listPagesViaPlaywright,
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
  getChromeTabId,
} from "../../browser/tab-groups.js";
import {
  isTabGrouperAvailable,
  createTabViaExtension,
  closeTabViaExtension,
} from "../../browser/chrome-tab-groups.js";

export function registerBrowserTabsTool(
  register: RegisterToolFn,
  config: ServerConfig,
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
          description:
            "Tab group name to scope this operation to (from browser_tab_group). " +
            "Recommended for multi-user isolation.",
        },
        url: {
          type: "string",
          description: "URL for 'new' action (defaults to about:blank)",
        },
        index: {
          type: "number",
          description:
            "Tab index for 'close' or 'select' actions (relative to group if groupId is set)",
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
      const cdp = config.cdpEndpoint;

      // Helper: get tabs scoped to group (or all tabs)
      async function getScopedTabs() {
        const allTabs = await listPagesViaPlaywright({ cdpUrl: cdp });

        // Prune stale entries
        try {
          const liveIds = allTabs.map((t) => t.targetId);
          await pruneStaleTargets(cdp, liveIds);
        } catch {
          // Best-effort
        }

        if (!groupId) {
          return allTabs;
        }

        // Validate group exists
        const group = await getTabGroup(cdp, groupId);
        if (!group) {
          throw new Error(
            `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
          );
        }

        const groupTargetIds = new Set(await getTabsInGroup(cdp, groupId));
        return allTabs.filter((t) => groupTargetIds.has(t.targetId));
      }

      // Helper: resolve target from index or targetId
      async function resolveTarget(
        scopedTabs: Array<{ targetId: string; title: string; url: string }>,
      ): Promise<string> {
        if (targetId) {
          if (groupId) {
            const tabGroup = await getGroupForTab(cdp, targetId);
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
              `No tab at index ${index}` + (groupId ? ` in group ${groupId}` : ""),
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

          const output: string[] = [];
          for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            let groupLabel = "";
            if (!groupId) {
              try {
                const g = await getGroupForTab(cdp, tab.targetId);
                groupLabel = g ? ` [${g}]` : " [ungrouped]";
              } catch {
                groupLabel = " [ungrouped]";
              }
            }
            output.push(
              `[${i}] **targetId: ${tab.targetId}**${groupLabel}\n` +
                `    ${tab.title || "(no title)"}\n` +
                `    ${tab.url}`,
            );
          }

          const label = groupId ? `in group ${groupId}` : "total";
          return `**${tabs.length} tab(s)** ${label}\n\n${output.join("\n\n")}`;
        }

        case "new": {
          if (!groupId) {
            throw new Error(
              "groupId is required when creating new tabs. " +
                "Create a tab group first with browser_tab_group, then pass the groupId here.",
            );
          }

          const group = await getTabGroup(cdp, groupId);
          if (!group) {
            throw new Error(
              `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
            );
          }

          const tabUrl = url || "about:blank";
          let resultTargetId: string;
          let chromeTabId: number | undefined;

          // Always try extension first (gives Chrome tab ID for grouping)
          const hasExtension = await isTabGrouperAvailable(cdp);
          if (hasExtension) {
            try {
              const extTab = await createTabViaExtension(cdp, tabUrl);
              resultTargetId = extTab.targetId;
              chromeTabId = extTab.chromeTabId;
            } catch {
              // Fall back to Playwright (no grouping possible)
              const { createPageViaPlaywright } = await import("../../browser/pw-session.js");
              const pwTab = await createPageViaPlaywright({ cdpUrl: cdp, url: tabUrl });
              resultTargetId = pwTab.targetId;
            }
          } else {
            const { createPageViaPlaywright } = await import("../../browser/pw-session.js");
            const pwTab = await createPageViaPlaywright({ cdpUrl: cdp, url: tabUrl });
            resultTargetId = pwTab.targetId;
          }

          // Register tab in extension (also handles Chrome visual grouping)
          if (chromeTabId !== undefined) {
            try {
              await addTabToGroup(cdp, resultTargetId, groupId, chromeTabId);
            } catch {
              // Registration failed — tab is still created but ungrouped
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
          let storedChromeTabId: number | null = null;
          try {
            storedChromeTabId = await getChromeTabId(cdp, tid);
          } catch {
            // Extension may not be available
          }

          // Close via extension if we have the Chrome tab ID
          if (storedChromeTabId !== null) {
            try {
              await closeTabViaExtension(cdp, storedChromeTabId);
            } catch {
              await closePageByTargetIdViaPlaywright({ cdpUrl: cdp, targetId: tid });
            }
          } else {
            await closePageByTargetIdViaPlaywright({ cdpUrl: cdp, targetId: tid });
          }

          // Unregister from extension
          try {
            await removeTabFromGroup(cdp, tid);
          } catch {
            // Best-effort
          }

          return `**Tab closed:** ${tid}`;
        }

        case "select": {
          const tabs = await getScopedTabs();
          const tid = await resolveTarget(tabs);

          await focusPageByTargetIdViaPlaywright({ cdpUrl: cdp, targetId: tid });

          return `**Tab focused:** ${tid}`;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  );
}
