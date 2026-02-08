/**
 * Tab group ownership registry.
 *
 * Provides per-session tab isolation via named groups.
 * State is persisted to a shared JSON file so multiple MCP stdio processes
 * (each serving a different user/session) can coordinate.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TabGroup {
  groupId: string;
  name: string;
  color?: string;
  createdAt: number;
  /** Chrome's internal visual group ID, if the companion extension is loaded */
  chromeGroupId?: number;
}

export interface TabEntry {
  groupId: string;
  addedAt: number;
}

export interface TabGroupRegistry {
  groups: Record<string, TabGroup>;
  /** keyed by CDP targetId */
  tabs: Record<string, TabEntry>;
  /** Cached companion extension ID (discovered on first probe) */
  extensionId?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), ".ultimate-playwright-mcp");
const REGISTRY_PATH = join(DATA_DIR, "tab-groups.json");
const LOCK_PATH = REGISTRY_PATH + ".lock";
// Lock is considered stale after 5s (handled in acquireLock via timeout)

const VALID_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
] as const;

export type TabGroupColor = (typeof VALID_COLORS)[number];

export function isValidColor(c: string): c is TabGroupColor {
  return (VALID_COLORS as readonly string[]).includes(c);
}

// ── File-level locking (simple, cross-process) ─────────────────────────────

function acquireLock(maxWaitMs = 3_000): void {
  const start = Date.now();
  while (true) {
    try {
      // O_EXCL-style: writeFileSync with flag "wx" fails if file exists
      writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
      return;
    } catch {
      // Check for stale lock
      try {
        const stat = readFileSync(LOCK_PATH, "utf-8");
        const pid = parseInt(stat, 10);
        if (pid && !isProcessAlive(pid)) {
          unlinkSync(LOCK_PATH);
          continue;
        }
      } catch {
        // lock file disappeared between our check and read — retry
      }
      if (Date.now() - start > maxWaitMs) {
        // Force-break stale lock
        try {
          unlinkSync(LOCK_PATH);
        } catch {}
        continue;
      }
      // Spin-wait briefly
      const wait = 20 + Math.random() * 30;
      const until = Date.now() + wait;
      while (Date.now() < until) {
        /* busy wait — we're in sync code */
      }
    }
  }
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Registry I/O ───────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readRegistry(): TabGroupRegistry {
  ensureDir();
  if (!existsSync(REGISTRY_PATH)) {
    return { groups: {}, tabs: {} };
  }
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      groups: parsed.groups ?? {},
      tabs: parsed.tabs ?? {},
    };
  } catch {
    return { groups: {}, tabs: {} };
  }
}

function writeRegistry(reg: TabGroupRegistry): void {
  ensureDir();
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), "utf-8");
}

/**
 * Run a read-modify-write operation on the registry with file locking.
 */
function withRegistry<T>(fn: (reg: TabGroupRegistry) => T): T {
  acquireLock();
  try {
    const reg = readRegistry();
    const result = fn(reg);
    writeRegistry(reg);
    return result;
  } finally {
    releaseLock();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

function generateGroupId(): string {
  return "g_" + randomBytes(8).toString("hex");
}

/**
 * Create a new tab group. Returns the created group.
 */
export function createTabGroup(opts: { name: string; color?: string }): TabGroup {
  const color = opts.color && isValidColor(opts.color) ? opts.color : undefined;
  const group: TabGroup = {
    groupId: generateGroupId(),
    name: opts.name.trim() || "unnamed",
    color,
    createdAt: Date.now(),
  };
  withRegistry((reg) => {
    reg.groups[group.groupId] = group;
  });
  return group;
}

/**
 * List all tab groups, optionally with tab counts.
 */
export function listTabGroups(): Array<TabGroup & { tabCount: number }> {
  acquireLock();
  try {
    const reg = readRegistry();
    return Object.values(reg.groups).map((g) => ({
      ...g,
      tabCount: Object.values(reg.tabs).filter((t) => t.groupId === g.groupId).length,
    }));
  } finally {
    releaseLock();
  }
}

/**
 * Delete a tab group. Returns the targetIds of tabs that were in it
 * (caller is responsible for actually closing them if desired).
 */
export function deleteTabGroup(groupId: string): { removedTargetIds: string[] } {
  const removed: string[] = [];
  withRegistry((reg) => {
    if (!reg.groups[groupId]) {
      throw new Error(`Tab group not found: ${groupId}`);
    }
    delete reg.groups[groupId];
    for (const [targetId, entry] of Object.entries(reg.tabs)) {
      if (entry.groupId === groupId) {
        removed.push(targetId);
        delete reg.tabs[targetId];
      }
    }
  });
  return { removedTargetIds: removed };
}

/**
 * Associate a targetId with a group.
 */
export function addTabToGroup(targetId: string, groupId: string): void {
  withRegistry((reg) => {
    if (!reg.groups[groupId]) {
      throw new Error(`Tab group not found: ${groupId}`);
    }
    reg.tabs[targetId] = { groupId, addedAt: Date.now() };
  });
}

/**
 * Remove a targetId from whatever group it belongs to.
 */
export function removeTabFromGroup(targetId: string): void {
  withRegistry((reg) => {
    delete reg.tabs[targetId];
  });
}

/**
 * Get the groupId for a given targetId, or null if unassigned.
 */
export function getGroupForTab(targetId: string): string | null {
  acquireLock();
  try {
    const reg = readRegistry();
    return reg.tabs[targetId]?.groupId ?? null;
  } finally {
    releaseLock();
  }
}

/**
 * Get all targetIds belonging to a group.
 */
export function getTabsInGroup(groupId: string): string[] {
  acquireLock();
  try {
    const reg = readRegistry();
    return Object.entries(reg.tabs)
      .filter(([, entry]) => entry.groupId === groupId)
      .map(([targetId]) => targetId);
  } finally {
    releaseLock();
  }
}

/**
 * Prune targetIds that no longer exist in the browser.
 * Pass in the set of live targetIds; any registry entries not in the set are removed.
 */
export function pruneStaleTargets(liveTargetIds: Set<string>): number {
  let pruned = 0;
  withRegistry((reg) => {
    for (const targetId of Object.keys(reg.tabs)) {
      if (!liveTargetIds.has(targetId)) {
        delete reg.tabs[targetId];
        pruned++;
      }
    }
  });
  return pruned;
}

/**
 * Get a group by ID, or null.
 */
export function getTabGroup(groupId: string): TabGroup | null {
  acquireLock();
  try {
    const reg = readRegistry();
    return reg.groups[groupId] ?? null;
  } finally {
    releaseLock();
  }
}

/**
 * Get the cached companion extension ID.
 */
export function getExtensionId(): string | null {
  acquireLock();
  try {
    const reg = readRegistry();
    return reg.extensionId ?? null;
  } finally {
    releaseLock();
  }
}

/**
 * Store the companion extension ID for future wake calls.
 */
export function setExtensionId(extensionId: string): void {
  withRegistry((reg) => {
    reg.extensionId = extensionId;
  });
}

/**
 * Store the Chrome visual group ID for a tab group.
 */
export function setChromeGroupId(groupId: string, chromeGroupId: number): void {
  withRegistry((reg) => {
    const group = reg.groups[groupId];
    if (group) {
      group.chromeGroupId = chromeGroupId;
    }
  });
}
