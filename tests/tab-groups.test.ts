/**
 * Tests for tab group registry — the core multi-agent isolation logic.
 *
 * UPMCP_DATA_DIR is set via vitest.config.ts to a temp directory.
 * We clean the registry file between tests for isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTabGroup,
  listTabGroups,
  deleteTabGroup,
  addTabToGroup,
  removeTabFromGroup,
  getTabsInGroup,
  getGroupForTab,
  pruneStaleTargets,
  getChromeTabId,
  getExtensionId,
  setExtensionId,
  setChromeGroupId,
  getTabGroup,
  isValidColor,
} from "../src/browser/tab-groups.js";

const dataDir = process.env.UPMCP_DATA_DIR!;
const registryPath = join(dataDir, "tab-groups.json");
const lockPath = registryPath + ".lock";

beforeEach(() => {
  // Clean registry between tests for isolation
  try { rmSync(registryPath, { force: true }); } catch { /* ok */ }
  try { rmSync(lockPath, { force: true }); } catch { /* ok */ }
});

describe("createTabGroup", () => {
  it("creates a group with generated ID and name", () => {
    const g = createTabGroup({ name: "test" });
    expect(g.groupId).toMatch(/^g_[0-9a-f]{16}$/);
    expect(g.name).toBe("test");
    expect(g.createdAt).toBeGreaterThan(0);
  });

  it("accepts valid color, ignores invalid", () => {
    const good = createTabGroup({ name: "a", color: "blue" });
    const bad = createTabGroup({ name: "b", color: "neon" });
    expect(good.color).toBe("blue");
    expect(bad.color).toBeUndefined();
  });

  it("persists to disk", () => {
    createTabGroup({ name: "persist" });
    expect(existsSync(registryPath)).toBe(true);
    const data = JSON.parse(readFileSync(registryPath, "utf-8"));
    expect(Object.keys(data.groups)).toHaveLength(1);
  });

  it("trims name, defaults empty to 'unnamed'", () => {
    const a = createTabGroup({ name: "  hi  " });
    const b = createTabGroup({ name: "" });
    expect(a.name).toBe("hi");
    expect(b.name).toBe("unnamed");
  });
});

describe("listTabGroups", () => {
  it("returns empty when no groups", () => {
    expect(listTabGroups()).toEqual([]);
  });

  it("includes tab counts", () => {
    const g1 = createTabGroup({ name: "g1" });
    const g2 = createTabGroup({ name: "g2" });
    addTabToGroup("t1", g1.groupId);
    addTabToGroup("t2", g1.groupId);
    addTabToGroup("t3", g2.groupId);
    const list = listTabGroups();
    expect(list).toHaveLength(2);
    expect(list.find(g => g.name === "g1")?.tabCount).toBe(2);
    expect(list.find(g => g.name === "g2")?.tabCount).toBe(1);
  });
});

describe("deleteTabGroup", () => {
  it("removes group and its tabs", () => {
    const g = createTabGroup({ name: "del" });
    addTabToGroup("x", g.groupId);
    addTabToGroup("y", g.groupId);
    const d = deleteTabGroup(g.groupId);
    expect(d.removedTargetIds.sort()).toEqual(["x", "y"]);
    expect(listTabGroups()).toHaveLength(0);
  });

  it("throws for nonexistent group", () => {
    expect(() => deleteTabGroup("g_fake")).toThrow("Tab group not found");
  });
});

describe("tab associations", () => {
  it("tracks tabs and groups bidirectionally", () => {
    const g = createTabGroup({ name: "a" });
    addTabToGroup("t1", g.groupId);
    addTabToGroup("t2", g.groupId);
    expect(getTabsInGroup(g.groupId).sort()).toEqual(["t1", "t2"]);
    expect(getGroupForTab("t1")).toBe(g.groupId);
    expect(getGroupForTab("nope")).toBeNull();
  });

  it("removes a tab", () => {
    const g = createTabGroup({ name: "rm" });
    addTabToGroup("z", g.groupId);
    removeTabFromGroup("z");
    expect(getGroupForTab("z")).toBeNull();
    expect(getTabsInGroup(g.groupId)).toHaveLength(0);
  });
});

describe("pruneStaleTargets", () => {
  it("removes targets not in live set", () => {
    const g = createTabGroup({ name: "p" });
    addTabToGroup("live", g.groupId);
    addTabToGroup("dead1", g.groupId);
    addTabToGroup("dead2", g.groupId);
    const pruned = pruneStaleTargets(new Set(["live"]));
    expect(pruned).toBe(2);
    expect(getTabsInGroup(g.groupId)).toEqual(["live"]);
  });
});

describe("multi-group isolation", () => {
  it("deleting one group doesn't affect another", () => {
    const alice = createTabGroup({ name: "alice", color: "blue" });
    const bob = createTabGroup({ name: "bob", color: "green" });
    addTabToGroup("a1", alice.groupId);
    addTabToGroup("b1", bob.groupId);
    deleteTabGroup(alice.groupId);
    expect(getTabsInGroup(bob.groupId)).toEqual(["b1"]);
    expect(listTabGroups()).toHaveLength(1);
  });
});

describe("isValidColor", () => {
  it("validates correctly", () => {
    expect(isValidColor("blue")).toBe(true);
    expect(isValidColor("cyan")).toBe(true);
    expect(isValidColor("magenta")).toBe(false);
    expect(isValidColor("")).toBe(false);
  });
});

describe("chrome integration metadata", () => {
  it("stores chrome tab ID", () => {
    const g = createTabGroup({ name: "c" });
    addTabToGroup("t", g.groupId, 42);
    expect(getChromeTabId("t")).toBe(42);
    expect(getChromeTabId("x")).toBeUndefined();
  });

  it("stores extension ID", () => {
    expect(getExtensionId()).toBeNull();
    setExtensionId("ext123");
    expect(getExtensionId()).toBe("ext123");
  });

  it("stores chrome visual group ID", () => {
    const g = createTabGroup({ name: "v" });
    setChromeGroupId(g.groupId, 99);
    const got = getTabGroup(g.groupId);
    expect(got?.chromeGroupId).toBe(99);
  });
});
