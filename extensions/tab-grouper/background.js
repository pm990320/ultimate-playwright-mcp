/**
 * UltimatePW Tab Grouper — companion extension for ultimate-playwright-mcp.
 *
 * This service worker is controlled via CDP Runtime.evaluate from the MCP server.
 * It exposes helper functions on `globalThis` that the server calls to manage
 * Chrome's native tab groups (title, color, grouping/ungrouping).
 *
 * No user interaction needed — it's purely a bridge to chrome.tabGroups.
 */

/**
 * Group tabs and set title/color in one call.
 * @param {number[]} tabIds  - Chrome tab IDs to group
 * @param {string}   title   - Group title
 * @param {string}   color   - One of: grey, blue, red, yellow, green, pink, purple, cyan
 * @param {number}   [existingGroupId] - If provided, add tabs to this existing group
 * @returns {Promise<{groupId: number}>}
 */
globalThis.groupTabs = async function groupTabs(tabIds, title, color, existingGroupId) {
  const opts = { tabIds };
  if (existingGroupId !== undefined && existingGroupId !== null) {
    opts.groupId = existingGroupId;
  }
  const groupId = await chrome.tabs.group(opts);
  await chrome.tabGroups.update(groupId, { title, color });
  return { groupId };
};

/**
 * Update an existing group's title and/or color.
 * @param {number} groupId
 * @param {object} updates - { title?: string, color?: string, collapsed?: boolean }
 * @returns {Promise<{ok: true}>}
 */
globalThis.updateTabGroup = async function updateTabGroup(groupId, updates) {
  await chrome.tabGroups.update(groupId, updates);
  return { ok: true };
};

/**
 * Ungroup specific tabs (removes them from their group).
 * @param {number[]} tabIds
 * @returns {Promise<{ok: true}>}
 */
globalThis.ungroupTabs = async function ungroupTabs(tabIds) {
  await chrome.tabs.ungroup(tabIds);
  return { ok: true };
};

/**
 * Get all tab groups in a specific window (or current window).
 * @param {number} [windowId]
 * @returns {Promise<Array<{id: number, title: string, color: string, collapsed: boolean}>>}
 */
globalThis.listTabGroups = async function listTabGroups(windowId) {
  const query = windowId ? { windowId } : {};
  const groups = await chrome.tabGroups.query(query);
  return groups.map(g => ({
    id: g.id,
    title: g.title,
    color: g.color,
    collapsed: g.collapsed,
  }));
};

/**
 * Query tabs with their groupId so we can map targetId → Chrome tabId.
 * @returns {Promise<Array<{id: number, url: string, title: string, groupId: number}>>}
 */
globalThis.queryTabs = async function queryTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    groupId: t.groupId,
  }));
};

/**
 * Create a new tab and return its Chrome tab ID immediately.
 * This is the preferred way to create tabs — gives us the tabId upfront,
 * avoiding the unreliable URL-based mapping from CDP targetIds.
 * @param {string} url - URL to navigate to
 * @param {boolean} [active=false] - Whether the tab should be active
 * @returns {Promise<{tabId: number, url: string, windowId: number}>}
 */
globalThis.createTab = async function createTab(url, active = false) {
  const tab = await chrome.tabs.create({ url, active });
  return { tabId: tab.id, url: tab.pendingUrl || tab.url || url, windowId: tab.windowId };
};

/**
 * Close a tab by its Chrome tab ID.
 * @param {number} tabId
 * @returns {Promise<{ok: true}>}
 */
globalThis.closeTab = async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  return { ok: true };
};

// ── Keepalive & wake support ───────────────────────────────────────────────
// MV3 service workers terminate after 30s of inactivity. We use two strategies:
// 1. chrome.alarms for periodic self-wake (minimum ~30s interval)
// 2. chrome.runtime.onMessageExternal so other extensions can wake us via sendMessage
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  // No-op: just being woken up keeps the SW target visible to CDP
});

// Allow external messages to wake us (the MCP server triggers this via another extension's SW)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  sendResponse({ ok: true, status: "awake" });
});

console.log("[UltimatePW Tab Grouper] Service worker ready");
