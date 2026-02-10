/**
 * Tab group ownership registry — extension-backed.
 *
 * All state is stored in the companion extension's chrome.storage.local.
 * The extension is the single source of truth for group ownership,
 * tab-to-group mapping, and CDP targetId ↔ Chrome tab ID correlation.
 *
 * This module provides a thin async API that the MCP tools call.
 * Under the hood it evaluates functions on the extension's service worker via CDP.
 */

import { evalOnExtension } from "./chrome-tab-groups.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TabGroup {
  name: string;
  color: string;
  createdAt: number;
  chromeGroupId: number | null;
  tabCount: number;
  tabs: Array<{ targetId: string; chromeTabId: number; addedAt: number }>;
}

export const VALID_COLORS = [
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan",
] as const;

export type TabGroupColor = (typeof VALID_COLORS)[number];

export function isValidColor(c: string): c is TabGroupColor {
  return (VALID_COLORS as readonly string[]).includes(c);
}

// ── Public API (all async, calls extension via CDP) ────────────────────────

/**
 * Create a new tab group. If a group with this name already exists, returns it.
 */
export async function createTabGroup(
  cdpUrl: string,
  opts: { name: string; color?: string },
): Promise<{ name: string; color: string; createdAt: number; created: boolean }> {
  const color = opts.color && isValidColor(opts.color) ? opts.color : "blue";
  const name = opts.name.trim() || "unnamed";
  return (await evalOnExtension(
    cdpUrl,
    `registerGroup(${JSON.stringify(name)}, ${JSON.stringify(color)})`,
  )) as { name: string; color: string; createdAt: number; created: boolean };
}

/**
 * List all tab groups with tab counts and live Chrome state.
 */
export async function listTabGroups(cdpUrl: string): Promise<TabGroup[]> {
  return (await evalOnExtension(cdpUrl, `getGroups()`)) as TabGroup[];
}

/**
 * Delete a tab group. Returns targetIds that were in it.
 */
export async function deleteTabGroup(
  cdpUrl: string,
  name: string,
): Promise<{ removed: boolean; ungroupedTargetIds: string[] }> {
  return (await evalOnExtension(
    cdpUrl,
    `removeGroup(${JSON.stringify(name)})`,
  )) as { removed: boolean; ungroupedTargetIds: string[] };
}

/**
 * Get a group by name, or null.
 */
export async function getTabGroup(
  cdpUrl: string,
  name: string,
): Promise<{ name: string; color: string; createdAt: number; chromeGroupId?: number } | null> {
  const result = (await evalOnExtension(
    cdpUrl,
    `getGroup(${JSON.stringify(name)})`,
  )) as { exists: boolean; group: { name: string; color: string; createdAt: number; chromeGroupId?: number } | null };
  return result.exists ? result.group : null;
}

/**
 * Register a tab in a group (stores mapping + adds to Chrome visual group).
 */
export async function addTabToGroup(
  cdpUrl: string,
  targetId: string,
  groupName: string,
  chromeTabId: number,
): Promise<{ chromeGroupId: number | null }> {
  return (await evalOnExtension(
    cdpUrl,
    `registerTab(${JSON.stringify(targetId)}, ${JSON.stringify(groupName)}, ${chromeTabId})`,
  )) as { ok: boolean; chromeGroupId: number | null };
}

/**
 * Unregister a tab from its group.
 */
export async function removeTabFromGroup(
  cdpUrl: string,
  targetId: string,
): Promise<void> {
  await evalOnExtension(cdpUrl, `unregisterTab(${JSON.stringify(targetId)})`);
}

/**
 * Get the group name for a given targetId, or null.
 */
export async function getGroupForTab(
  cdpUrl: string,
  targetId: string,
): Promise<string | null> {
  return (await evalOnExtension(
    cdpUrl,
    `getGroupForTarget(${JSON.stringify(targetId)})`,
  )) as string | null;
}

/**
 * Get all targetIds belonging to a group.
 */
export async function getTabsInGroup(
  cdpUrl: string,
  groupName: string,
): Promise<string[]> {
  return (await evalOnExtension(
    cdpUrl,
    `getTargetsInGroup(${JSON.stringify(groupName)})`,
  )) as string[];
}

/**
 * Get the Chrome tab ID for a CDP targetId.
 */
export async function getChromeTabId(
  cdpUrl: string,
  targetId: string,
): Promise<number | null> {
  return (await evalOnExtension(
    cdpUrl,
    `getChromeTabIdForTarget(${JSON.stringify(targetId)})`,
  )) as number | null;
}

/**
 * Prune targetIds that no longer exist in the browser.
 */
export async function pruneStaleTargets(
  cdpUrl: string,
  liveTargetIds: string[],
): Promise<number> {
  const result = (await evalOnExtension(
    cdpUrl,
    `pruneTargets(${JSON.stringify(liveTargetIds)})`,
  )) as { pruned: number };
  return result.pruned;
}
