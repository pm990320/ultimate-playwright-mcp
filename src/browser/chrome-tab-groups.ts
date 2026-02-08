/**
 * Chrome visual tab groups via the companion extension.
 *
 * Connects to the "UltimatePW Tab Grouper" extension's service worker
 * via CDP and calls its global helpers (groupTabs, ungroupTabs, etc.)
 * to manage native Chrome tab groups with titles and colors.
 *
 * Falls back gracefully — if the extension isn't loaded, visual grouping
 * is simply skipped and a warning is returned.
 */

import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import WebSocket from "ws";
import { getHeadersWithAuth } from "./cdp.helpers.js";
import { getExtensionId as getStoredExtensionId, setExtensionId as storeExtensionId } from "./tab-groups.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CDPResponse {
  id: number;
  result?: {
    result?: {
      type: string;
      value?: unknown;
      description?: string;
      subtype?: string;
    };
    exceptionDetails?: {
      text: string;
      exception?: { description?: string };
    };
  };
  error?: { message: string };
}

// ── Find the extension service worker ──────────────────────────────────────

let cachedSwUrl: string | null = null;
let cachedCdpBase: string | null = null;
/** Cached extension ID so we can wake it when dormant */
let cachedExtensionId: string | null = null;

/**
 * Compute a Chrome unpacked extension ID from its absolute directory path.
 * Chrome uses SHA-256 of the path, maps each nibble to a-p.
 */
export function computeExtensionId(extensionPath: string): string {
  const abs = resolvePath(extensionPath);
  const hash = createHash("sha256").update(abs).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    const byte = hash[i];
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0xf));
  }
  return id;
}

/**
 * Pre-seed the extension ID from a known path. Call this during server init
 * so the wake mechanism works even before the first probe succeeds.
 */
export function seedExtensionIdFromPath(extensionPath: string): void {
  const id = computeExtensionId(extensionPath);
  cachedExtensionId = id;
  storeExtensionId(id);
}

async function findExtensionServiceWorker(cdpUrl: string): Promise<string | null> {
  const baseUrl = cdpUrl
    .replace(/\/+$/, "")
    .replace(/^ws:/, "http:")
    .replace(/\/cdp$/, "");

  // Use cached result if same CDP base
  if (cachedSwUrl && cachedCdpBase === baseUrl) {
    // Verify it's still alive
    try {
      const resp = await fetch(`${baseUrl}/json/list`, {
        signal: AbortSignal.timeout(2000),
        headers: getHeadersWithAuth(`${baseUrl}/json/list`),
      });
      if (resp.ok) {
        const targets = (await resp.json()) as CDPTarget[];
        if (targets.some((t) => t.webSocketDebuggerUrl === cachedSwUrl)) {
          return cachedSwUrl;
        }
      }
    } catch {
      // Cache miss
    }
    cachedSwUrl = null;
    cachedCdpBase = null;
  }

  try {
    const resp = await fetch(`${baseUrl}/json/list`, {
      signal: AbortSignal.timeout(3000),
      headers: getHeadersWithAuth(`${baseUrl}/json/list`),
    });
    if (!resp.ok) return null;

    const targets = (await resp.json()) as CDPTarget[];
    // Find our companion extension's service worker by probing each
    // extension SW for the `groupTabs` global we define.
    const candidates = targets.filter(
      (t) =>
        t.type === "service_worker" &&
        t.url.startsWith("chrome-extension://") &&
        t.webSocketDebuggerUrl,
    );

    for (const candidate of candidates) {
      try {
        const hasGroupTabs = await probeForGroupTabs(candidate.webSocketDebuggerUrl);
        if (hasGroupTabs) {
          cachedSwUrl = candidate.webSocketDebuggerUrl;
          cachedCdpBase = baseUrl;
          // Extract and persist the extension ID from URL
          const extIdMatch = candidate.url.match(/chrome-extension:\/\/([a-z]+)\//);
          if (extIdMatch) {
            cachedExtensionId = extIdMatch[1];
            storeExtensionId(cachedExtensionId);
          }
          return cachedSwUrl;
        }
      } catch {
        // This SW doesn't have our function, or it's dormant — skip
      }
    }

    // If we have a cached or persisted extension ID, try to wake the dormant SW
    // by sending it a message from any available extension SW
    const extId = cachedExtensionId || getStoredExtensionId();
    if (extId) {
      cachedExtensionId = extId;
      // Use ALL extension SWs (not just candidates) as potential senders
      const allSWs = targets.filter(
        (t) => t.type === "service_worker" && t.webSocketDebuggerUrl,
      );
      const woke = await wakeExtension(baseUrl, extId, allSWs);
      if (woke) {
        // Re-scan after wake
        const resp2 = await fetch(`${baseUrl}/json/list`, {
          signal: AbortSignal.timeout(3000),
          headers: getHeadersWithAuth(`${baseUrl}/json/list`),
        });
        if (resp2.ok) {
          const refreshed = (await resp2.json()) as CDPTarget[];
          for (const candidate of refreshed.filter(
            (t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"),
          )) {
            try {
              const hasGroupTabs = await probeForGroupTabs(candidate.webSocketDebuggerUrl);
              if (hasGroupTabs) {
                cachedSwUrl = candidate.webSocketDebuggerUrl;
                cachedCdpBase = baseUrl;
                // Persist the extension ID
                const m = candidate.url.match(/chrome-extension:\/\/([a-z]+)\//);
                if (m) {
                  cachedExtensionId = m[1];
                  storeExtensionId(m[1]);
                }
                return cachedSwUrl;
              }
            } catch {
              // skip
            }
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Wake a dormant extension service worker ────────────────────────────────

/**
 * Wake a dormant MV3 extension by sending it a message from another extension's
 * service worker. Chrome re-starts the target SW to deliver the message.
 */
async function wakeExtension(
  _cdpBaseUrl: string,
  extensionId: string,
  availableSWs: CDPTarget[],
): Promise<boolean> {
  // Find any OTHER extension SW that's alive to send the wake message from
  const sender = availableSWs.find(
    (t) => t.webSocketDebuggerUrl && !t.url.includes(extensionId),
  );
  if (!sender) return false;

  try {
    const result = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        sock.close();
        resolve(false);
      }, 5000);

      const sock = new WebSocket(sender.webSocketDebuggerUrl);
      sock.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      sock.on("open", () => {
        sock.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression: `chrome.runtime.sendMessage("${extensionId}", {type:"wake"}).then(() => true).catch(() => true)`,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        );
      });
      sock.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as CDPResponse;
        if (msg.id === 1) {
          clearTimeout(timer);
          sock.close();
          resolve(true);
        }
      });
    });

    if (result) {
      // Give the SW a moment to start up
      await new Promise((r) => setTimeout(r, 2500));
    }
    return result;
  } catch {
    return false;
  }
}

// ── Probe a service worker for our extension ───────────────────────────────

async function probeForGroupTabs(wsUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("probe timeout"));
    }, 3000);

    const sock = new WebSocket(wsUrl);
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on("open", () => {
      sock.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: "typeof groupTabs === 'function'",
            returnByValue: true,
          },
        }),
      );
    });
    sock.on("message", (data) => {
      let msg: CDPResponse;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      sock.close();
      resolve(msg.result?.result?.value === true);
    });
  });
}

// ── Evaluate JS on the extension service worker ────────────────────────────

async function evalOnExtension(
  cdpUrl: string,
  expression: string,
  timeout = 10_000,
): Promise<unknown> {
  const wsUrl = await findExtensionServiceWorker(cdpUrl);
  if (!wsUrl) {
    throw new ExtensionNotFoundError();
  }

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("CDP evaluation timed out"));
    }, timeout);

    const sock = new WebSocket(wsUrl);

    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    sock.on("open", () => {
      sock.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });

    sock.on("message", (data) => {
      let msg: CDPResponse;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id !== 1) return;

      clearTimeout(timer);
      sock.close();

      if (msg.error) {
        reject(new Error(`CDP error: ${msg.error.message}`));
        return;
      }

      const result = msg.result?.result;
      const exception = msg.result?.exceptionDetails;

      if (exception) {
        const detail =
          exception.exception?.description || exception.text || "Unknown error";
        reject(new Error(`Extension error: ${detail}`));
        return;
      }

      if (result?.subtype === "error") {
        reject(new Error(`Extension error: ${result.description || "Unknown"}`));
        return;
      }

      resolve(result?.value);
    });
  });
}

// ── Custom error for missing extension ─────────────────────────────────────

export class ExtensionNotFoundError extends Error {
  constructor() {
    super(
      `Tab Grouper extension not found. Visual tab groups require the companion extension.\n` +
        `Load it with: --chrome-extensions extensions/tab-grouper`,
    );
    this.name = "ExtensionNotFoundError";
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether the companion extension is available.
 */
/**
 * Warm up: discover and cache the extension ID while the SW is still alive
 * (should be called soon after Chrome starts). Best-effort, non-blocking.
 */
export async function warmupTabGrouper(cdpUrl: string): Promise<void> {
  try {
    await findExtensionServiceWorker(cdpUrl);
  } catch {
    // Best-effort
  }
}

export async function isTabGrouperAvailable(cdpUrl: string): Promise<boolean> {
  const wsUrl = await findExtensionServiceWorker(cdpUrl);
  return wsUrl !== null;
}

/**
 * Get the Chrome tab ID for a given URL + title combo.
 * We need this to bridge CDP targetId → Chrome tab ID.
 */
export async function getChromeTabId(
  cdpUrl: string,
  targetUrl: string,
  targetTitle?: string,
): Promise<number | null> {
  try {
    const tabs = (await evalOnExtension(
      cdpUrl,
      `queryTabs()`,
    )) as Array<{ id: number; url: string; title: string; groupId: number }>;

    // Match by URL (most reliable)
    const urlMatches = tabs.filter((t) => t.url === targetUrl);
    if (urlMatches.length === 1) return urlMatches[0].id;

    // If multiple URL matches, narrow by title
    if (urlMatches.length > 1 && targetTitle) {
      const titleMatch = urlMatches.find((t) => t.title === targetTitle);
      if (titleMatch) return titleMatch.id;
    }

    return urlMatches[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Map CDP targetIds to Chrome tab IDs by correlating URL/title.
 * Returns a map of targetId → chromeTabId.
 */
export async function mapTargetIdsToChromeTabIds(
  cdpUrl: string,
  targets: Array<{ targetId: string; url: string; title: string }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  let chromeTabs: Array<{ id: number; url: string; title: string; groupId: number }>;
  try {
    chromeTabs = (await evalOnExtension(cdpUrl, `queryTabs()`)) as typeof chromeTabs;
  } catch {
    return result;
  }

  // Build URL → chrome tabs index
  const byUrl = new Map<string, Array<{ id: number; title: string }>>();
  for (const ct of chromeTabs) {
    const list = byUrl.get(ct.url) || [];
    list.push({ id: ct.id, title: ct.title });
    byUrl.set(ct.url, list);
  }

  for (const target of targets) {
    const candidates = byUrl.get(target.url);
    if (!candidates?.length) continue;

    if (candidates.length === 1) {
      result.set(target.targetId, candidates[0].id);
    } else {
      // Multiple tabs with same URL, try title match
      const titleMatch = candidates.find((c) => c.title === target.title);
      if (titleMatch) {
        result.set(target.targetId, titleMatch.id);
      }
    }
  }

  return result;
}

/**
 * Group Chrome tabs visually with a title and color.
 * @param chromeTabIds - Chrome internal tab IDs (not CDP targetIds)
 * @param title - Group title
 * @param color - grey|blue|red|yellow|green|pink|purple|cyan
 * @param existingGroupId - If provided, add to an existing Chrome group
 * @returns Chrome's groupId
 */
export async function groupTabsVisually(
  cdpUrl: string,
  chromeTabIds: number[],
  title: string,
  color: string,
  existingGroupId?: number,
): Promise<{ groupId: number }> {
  const existingArg =
    existingGroupId !== undefined ? `, ${existingGroupId}` : "";
  const result = (await evalOnExtension(
    cdpUrl,
    `groupTabs([${chromeTabIds.join(",")}], ${JSON.stringify(title)}, ${JSON.stringify(color)}${existingArg})`,
  )) as { groupId: number };
  return result;
}

/**
 * Remove tabs from their Chrome visual group.
 */
export async function ungroupTabsVisually(
  cdpUrl: string,
  chromeTabIds: number[],
): Promise<void> {
  await evalOnExtension(cdpUrl, `ungroupTabs([${chromeTabIds.join(",")}])`);
}

/**
 * Update a Chrome visual group's title/color/collapsed state.
 */
export async function updateVisualGroup(
  cdpUrl: string,
  chromeGroupId: number,
  updates: { title?: string; color?: string; collapsed?: boolean },
): Promise<void> {
  await evalOnExtension(
    cdpUrl,
    `updateTabGroup(${chromeGroupId}, ${JSON.stringify(updates)})`,
  );
}

/**
 * List all Chrome visual tab groups.
 */
export async function listVisualTabGroups(
  cdpUrl: string,
): Promise<Array<{ id: number; title: string; color: string; collapsed: boolean }>> {
  return (await evalOnExtension(cdpUrl, `listTabGroups()`)) as Array<{
    id: number;
    title: string;
    color: string;
    collapsed: boolean;
  }>;
}

/**
 * Create a tab via the extension (gives us the Chrome tab ID directly).
 * This avoids the unreliable URL-based mapping from CDP targetIds.
 * Returns both the Chrome tabId and the CDP targetId.
 */
export async function createTabViaExtension(
  cdpUrl: string,
  url: string,
): Promise<{ chromeTabId: number; targetId: string; url: string }> {
  // Snapshot existing CDP targets BEFORE creating the tab
  const beforeResp = await fetch(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(3000),
    headers: getHeadersWithAuth(`${cdpUrl}/json/list`),
  });
  const beforeTargets = beforeResp.ok
    ? ((await beforeResp.json()) as CDPTarget[])
    : [];
  const beforeIds = new Set(beforeTargets.map((t) => t.id));

  // Create the tab via extension
  const result = (await evalOnExtension(
    cdpUrl,
    `createTab(${JSON.stringify(url)})`,
  )) as { tabId: number; url: string; windowId: number };

  // Poll for the NEW CDP target (one that wasn't in the before snapshot)
  let targetId: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const resp = await fetch(`${cdpUrl}/json/list`, {
      signal: AbortSignal.timeout(3000),
      headers: getHeadersWithAuth(`${cdpUrl}/json/list`),
    });
    if (resp.ok) {
      const targets = (await resp.json()) as CDPTarget[];
      const newTarget = targets.find(
        (t) => t.type === "page" && !beforeIds.has(t.id),
      );
      if (newTarget) {
        targetId = newTarget.id;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!targetId) {
    throw new Error(
      `Created Chrome tab ${result.tabId} but could not find new CDP target`,
    );
  }

  return { chromeTabId: result.tabId, targetId, url: result.url };
}

/**
 * Close a tab via the extension using its Chrome tab ID.
 */
export async function closeTabViaExtension(
  cdpUrl: string,
  chromeTabId: number,
): Promise<void> {
  await evalOnExtension(cdpUrl, `closeTab(${chromeTabId})`);
}
