/**
 * UltimatePW Tab Grouper — companion extension for ultimate-playwright-mcp.
 *
 * This service worker is controlled via CDP Runtime.evaluate from the MCP server.
 * It exposes helper functions on `globalThis` that the server calls to manage
 * Chrome's native tab groups (title, color, grouping/ungrouping).
 *
 * State is persisted in chrome.storage.local so it survives Chrome restarts,
 * daemon deaths, and service worker hibernation. This is the single source of
 * truth for tab group ownership — no external JSON files needed.
 *
 * Storage schema:
 * {
 *   groups: { [name]: { color, createdAt, chromeGroupId? } },
 *   tabs: { [targetId]: { groupName, chromeTabId, addedAt } }
 * }
 */

// ── Storage helpers ────────────────────────────────────────────────────────

async function getStorage() {
  const data = await chrome.storage.local.get({ groups: {}, tabs: {} });
  return { groups: data.groups || {}, tabs: data.tabs || {} };
}

async function setStorage(data) {
  await chrome.storage.local.set(data);
}

// ── Group management ───────────────────────────────────────────────────────

/**
 * Register a new tab group. Stores metadata; Chrome visual group is created
 * when the first tab is added (Chrome groups can't exist without tabs).
 * @param {string} name - Group name (used as primary key)
 * @param {string} [color='blue'] - grey|blue|red|yellow|green|pink|purple|cyan
 * @returns {Promise<{name: string, color: string, createdAt: number, created: boolean}>}
 */
globalThis.registerGroup = async function registerGroup(name, color = "blue") {
  const store = await getStorage();
  if (store.groups[name]) {
    return { ...store.groups[name], name, created: false };
  }
  const group = { color, createdAt: Date.now() };
  store.groups[name] = group;
  await setStorage({ groups: store.groups });
  return { ...group, name, created: true };
};

/**
 * List all registered groups with live Chrome state and tab counts.
 * Reconciles stored chromeGroupId with actual Chrome groups (they may have
 * been invalidated by a Chrome restart).
 * @returns {Promise<Array<{name, color, createdAt, chromeGroupId, tabCount, tabs}>>}
 */
globalThis.getGroups = async function getGroups() {
  const store = await getStorage();
  const liveGroups = await chrome.tabGroups.query({});
  const liveGroupMap = new Map(liveGroups.map(g => [g.id, g]));

  const results = [];
  for (const [name, meta] of Object.entries(store.groups)) {
    // Count tabs belonging to this group
    const groupTabs = Object.entries(store.tabs)
      .filter(([, t]) => t.groupName === name)
      .map(([targetId, t]) => ({ targetId, chromeTabId: t.chromeTabId, addedAt: t.addedAt }));

    // Validate chromeGroupId is still alive
    let chromeGroupId = meta.chromeGroupId;
    if (chromeGroupId && !liveGroupMap.has(chromeGroupId)) {
      // Chrome group was destroyed (restart, all tabs closed, etc.)
      // Try to find it by title match
      const match = liveGroups.find(g => g.title === name);
      if (match) {
        chromeGroupId = match.id;
        meta.chromeGroupId = chromeGroupId;
      } else {
        chromeGroupId = null;
        delete meta.chromeGroupId;
      }
    }

    results.push({
      name,
      color: meta.color || "blue",
      createdAt: meta.createdAt,
      chromeGroupId: chromeGroupId || null,
      tabCount: groupTabs.length,
      tabs: groupTabs,
    });
  }

  // Save any reconciled chromeGroupIds
  await setStorage({ groups: store.groups });
  return results;
};

/**
 * Remove a group. Ungroups its Chrome tabs but does NOT close them.
 * @param {string} name - Group name to remove
 * @returns {Promise<{removed: boolean, ungroupedTargetIds: string[]}>}
 */
globalThis.removeGroup = async function removeGroup(name) {
  const store = await getStorage();
  if (!store.groups[name]) {
    return { removed: false, ungroupedTargetIds: [] };
  }

  // Find all tabs in this group
  const targetIds = [];
  const chromeTabIds = [];
  for (const [targetId, entry] of Object.entries(store.tabs)) {
    if (entry.groupName === name) {
      targetIds.push(targetId);
      if (entry.chromeTabId) chromeTabIds.push(entry.chromeTabId);
      delete store.tabs[targetId];
    }
  }

  // Ungroup Chrome tabs (best-effort — tabs may already be closed)
  if (chromeTabIds.length > 0) {
    try {
      await chrome.tabs.ungroup(chromeTabIds);
    } catch (e) {
      // Some tabs may not exist anymore
    }
  }

  delete store.groups[name];
  await setStorage({ groups: store.groups, tabs: store.tabs });
  return { removed: true, ungroupedTargetIds: targetIds };
};

// ── Tab management ─────────────────────────────────────────────────────────

/**
 * Register a tab in a group. Also adds it to the Chrome visual group
 * (creating the Chrome group if this is the first tab).
 * @param {string} targetId - CDP target ID
 * @param {string} groupName - Group name
 * @param {number} chromeTabId - Chrome's internal tab ID
 * @returns {Promise<{ok: true, chromeGroupId: number|null}>}
 */
globalThis.registerTab = async function registerTab(targetId, groupName, chromeTabId) {
  const store = await getStorage();
  const group = store.groups[groupName];
  if (!group) {
    throw new Error(`Group "${groupName}" not found. Create it first with registerGroup.`);
  }

  // Store the tab entry
  store.tabs[targetId] = { groupName, chromeTabId, addedAt: Date.now() };

  // Add to Chrome visual group
  let chromeGroupId = group.chromeGroupId || null;
  try {
    if (chromeGroupId) {
      // Verify the Chrome group still exists
      try {
        await chrome.tabGroups.get(chromeGroupId);
      } catch {
        chromeGroupId = null;
        delete group.chromeGroupId;
      }
    }

    if (chromeGroupId) {
      // Add to existing group
      await chrome.tabs.group({ tabIds: [chromeTabId], groupId: chromeGroupId });
    } else {
      // Create new Chrome group
      const newGroupId = await chrome.tabs.group({ tabIds: [chromeTabId] });
      await chrome.tabGroups.update(newGroupId, {
        title: groupName,
        color: group.color || "blue",
      });
      chromeGroupId = newGroupId;
      group.chromeGroupId = newGroupId;
    }
  } catch (e) {
    // Visual grouping failed — tab is still registered logically
    console.warn(`[Tab Grouper] Visual grouping failed for tab ${chromeTabId}:`, e);
  }

  await setStorage({ groups: store.groups, tabs: store.tabs });
  return { ok: true, chromeGroupId };
};

/**
 * Unregister a tab (remove from group tracking).
 * Does NOT close the tab or ungroup it visually.
 * @param {string} targetId - CDP target ID
 * @returns {Promise<{ok: true, groupName: string|null}>}
 */
globalThis.unregisterTab = async function unregisterTab(targetId) {
  const store = await getStorage();
  const entry = store.tabs[targetId];
  const groupName = entry?.groupName || null;
  delete store.tabs[targetId];
  await setStorage({ tabs: store.tabs });
  return { ok: true, groupName };
};

/**
 * Get the group name for a CDP target ID.
 * @param {string} targetId
 * @returns {Promise<string|null>}
 */
globalThis.getGroupForTarget = async function getGroupForTarget(targetId) {
  const store = await getStorage();
  return store.tabs[targetId]?.groupName || null;
};

/**
 * Get all CDP target IDs belonging to a group.
 * @param {string} groupName
 * @returns {Promise<string[]>}
 */
globalThis.getTargetsInGroup = async function getTargetsInGroup(groupName) {
  const store = await getStorage();
  return Object.entries(store.tabs)
    .filter(([, t]) => t.groupName === groupName)
    .map(([targetId]) => targetId);
};

/**
 * Get the stored Chrome tab ID for a CDP target ID.
 * @param {string} targetId
 * @returns {Promise<number|null>}
 */
globalThis.getChromeTabIdForTarget = async function getChromeTabIdForTarget(targetId) {
  const store = await getStorage();
  return store.tabs[targetId]?.chromeTabId || null;
};

/**
 * Remove stale target IDs that no longer exist in the browser.
 * @param {string[]} liveTargetIds - Array of currently live CDP target IDs
 * @returns {Promise<{pruned: number}>}
 */
globalThis.pruneTargets = async function pruneTargets(liveTargetIds) {
  const liveSet = new Set(liveTargetIds);
  const store = await getStorage();
  let pruned = 0;
  for (const targetId of Object.keys(store.tabs)) {
    if (!liveSet.has(targetId)) {
      delete store.tabs[targetId];
      pruned++;
    }
  }
  if (pruned > 0) {
    await setStorage({ tabs: store.tabs });
  }
  return { pruned };
};

/**
 * Check if a group exists.
 * @param {string} name
 * @returns {Promise<{exists: boolean, group: object|null}>}
 */
globalThis.getGroup = async function getGroup(name) {
  const store = await getStorage();
  const group = store.groups[name];
  if (!group) return { exists: false, group: null };
  return { exists: true, group: { name, ...group } };
};

// ── Original tab/group primitives (kept for compatibility) ─────────────────

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
 */
globalThis.updateTabGroup = async function updateTabGroup(groupId, updates) {
  await chrome.tabGroups.update(groupId, updates);
  return { ok: true };
};

/**
 * Ungroup specific tabs.
 */
globalThis.ungroupTabs = async function ungroupTabs(tabIds) {
  await chrome.tabs.ungroup(tabIds);
  return { ok: true };
};

/**
 * Get all Chrome tab groups.
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
 * Query all tabs with their groupId.
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
 * Create a new tab and return its Chrome tab ID.
 */
globalThis.createTab = async function createTab(url, active = false) {
  const tab = await chrome.tabs.create({ url, active });
  return { tabId: tab.id, url: tab.pendingUrl || tab.url || url, windowId: tab.windowId };
};

/**
 * Close a tab by its Chrome tab ID.
 */
globalThis.closeTab = async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  return { ok: true };
};

// ── Keepalive & wake support ───────────────────────────────────────────────

chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  // No-op: just being woken up keeps the SW target visible to CDP
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  sendResponse({ ok: true, status: "awake" });
});

console.log("[UltimatePW Tab Grouper] Service worker ready (storage-backed)");
