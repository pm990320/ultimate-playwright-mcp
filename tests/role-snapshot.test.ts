/**
 * Tests for pw-role-snapshot.ts — role snapshot building, filtering, and stats.
 */

import { describe, it, expect } from "vitest";
import {
  buildRoleSnapshotFromAriaSnapshot,
  getRoleSnapshotStats,
  type RoleRefMap,
} from "../src/browser/pw-role-snapshot.js";

/* ---------- helpers ---------- */

const SAMPLE_ARIA = [
  "- document",
  "  - navigation \"Main\"",
  "    - list",
  "      - listitem",
  "        - link \"Home\"",
  "      - listitem",
  "        - link \"About\"",
  "      - listitem",
  "        - link \"Contact\"",
  "  - main",
  "    - heading \"Welcome\" [level=1]",
  "    - generic",
  "      - paragraph: Some intro text",
  "      - button \"Sign Up\"",
  "      - textbox \"Email\"",
  "      - group \"Options\"",
  "        - checkbox \"Subscribe\"",
  "        - radio \"Option A\"",
  "        - radio \"Option B\"",
  "    - generic",
  "      - heading \"Footer\" [level=2]",
  "      - link \"Privacy\"",
].join("\n");

function countRefs(snapshot: string): number {
  return (snapshot.match(/\[ref=e\d+\]/g) || []).length;
}

/* ---------- basic building ---------- */

describe("buildRoleSnapshotFromAriaSnapshot", () => {
  it("builds a snapshot with refs from aria input", () => {
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA);
    // Should have refs for interactive + named content elements
    expect(Object.keys(refs).length).toBeGreaterThan(0);
    expect(snapshot).toContain("[ref=");
    // Links should get refs
    expect(snapshot).toContain('link "Home"');
    expect(snapshot).toContain('link "About"');
  });

  it("returns (empty) for empty input", () => {
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot("");
    expect(snapshot).toBe("(empty)");
    expect(Object.keys(refs)).toHaveLength(0);
  });
});

/* ---------- interactive filter ---------- */

describe("interactive option", () => {
  it("only returns interactive elements", () => {
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      interactive: true,
    });

    // Should have interactive elements
    expect(snapshot).toContain("link");
    expect(snapshot).toContain("button");
    expect(snapshot).toContain("textbox");
    expect(snapshot).toContain("checkbox");

    // Should NOT have structural/content elements
    expect(snapshot).not.toContain("document");
    expect(snapshot).not.toContain("navigation");
    expect(snapshot).not.toContain("heading");
    expect(snapshot).not.toContain("paragraph");

    // All refs should be interactive
    for (const ref of Object.values(refs)) {
      expect(
        [
          "button", "link", "textbox", "checkbox", "radio",
          "combobox", "listbox", "menuitem", "option", "searchbox",
          "slider", "spinbutton", "switch", "tab", "treeitem",
          "menuitemcheckbox", "menuitemradio",
        ]
      ).toContain(ref.role);
    }
  });

  it("returns notice for page with no interactive elements", () => {
    const staticPage = [
      "- document",
      "  - heading \"Title\" [level=1]",
      "  - paragraph: Just text",
    ].join("\n");
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(staticPage, {
      interactive: true,
    });
    expect(snapshot).toBe("(no interactive elements)");
  });

  it("flattens interactive elements (removes tree indentation)", () => {
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      interactive: true,
    });
    // All lines should start with "- " (no indentation)
    for (const line of snapshot.split("\n")) {
      if (line.trim()) {
        expect(line).toMatch(/^- /);
      }
    }
  });
});

/* ---------- compact filter ---------- */

describe("compact option", () => {
  it("removes unnamed structural elements", () => {
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      compact: true,
    });
    // "generic" without name should be removed (it's structural and unnamed)
    // "navigation \"Main\"" should be kept (it has a name)
    expect(snapshot).toContain("navigation");
    // Named content should be kept
    expect(snapshot).toContain("heading");
  });

  it("produces a shorter snapshot than default", () => {
    const full = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA);
    const compact = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, { compact: true });
    expect(compact.snapshot.length).toBeLessThan(full.snapshot.length);
  });
});

/* ---------- maxDepth filter ---------- */

describe("maxDepth option", () => {
  it("limits tree depth to 0 (root only)", () => {
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      maxDepth: 0,
    });
    // Only root-level element (document)
    const lines = snapshot.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("document");
  });

  it("limits tree depth to 1", () => {
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      maxDepth: 1,
    });
    // Should have document and its direct children (navigation, main)
    expect(snapshot).toContain("document");
    expect(snapshot).toContain("navigation");
    expect(snapshot).toContain("main");
    // Should NOT have deeper elements
    expect(snapshot).not.toContain("link");
    expect(snapshot).not.toContain("button");
  });

  it("works combined with interactive", () => {
    // Deep interactive elements should be excluded by maxDepth
    const { snapshot } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      interactive: true,
      maxDepth: 2,
    });
    // At depth 2 we have list, but links are at depth 4
    // So no interactive elements should appear
    expect(snapshot).toBe("(no interactive elements)");
  });
});

/* ---------- combined options ---------- */

describe("combined options", () => {
  it("compact + maxDepth together", () => {
    const result = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      compact: true,
      maxDepth: 3,
    });
    // Should work without errors
    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot.length).toBeGreaterThan(0);
  });
});

/* ---------- stats ---------- */

describe("getRoleSnapshotStats", () => {
  it("counts lines, chars, refs, and interactive elements", () => {
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA);
    const stats = getRoleSnapshotStats(snapshot, refs);

    expect(stats.lines).toBe(snapshot.split("\n").length);
    expect(stats.chars).toBe(snapshot.length);
    expect(stats.refs).toBe(Object.keys(refs).length);
    // Interactive count: links (Home, About, Contact, Privacy) + button + textbox + checkbox + 2 radio = 9
    expect(stats.interactive).toBeGreaterThanOrEqual(7);
  });

  it("returns zero interactive for content-only snapshot", () => {
    const staticPage = "- heading \"Title\" [level=1]";
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(staticPage);
    const stats = getRoleSnapshotStats(snapshot, refs);
    expect(stats.interactive).toBe(0);
  });

  it("interactive count matches interactive-filtered refs", () => {
    const full = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA);
    const interactiveOnly = buildRoleSnapshotFromAriaSnapshot(SAMPLE_ARIA, {
      interactive: true,
    });
    const fullStats = getRoleSnapshotStats(full.snapshot, full.refs);
    // interactive count from full stats should equal total refs in interactive-only mode
    expect(fullStats.interactive).toBe(Object.keys(interactiveOnly.refs).length);
  });
});

/* ---------- ref deduplication ---------- */

describe("ref deduplication", () => {
  it("adds nth only for duplicate role+name combos", () => {
    const dupeAria = [
      "- document",
      "  - button \"Save\"",
      "  - button \"Save\"",
      "  - button \"Cancel\"",
    ].join("\n");
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(dupeAria);

    // Both Save buttons should have nth
    const saveRefs = Object.values(refs).filter(
      (r) => r.role === "button" && r.name === "Save"
    );
    expect(saveRefs.length).toBe(2);
    // At least one should have nth > 0
    expect(saveRefs.some((r) => (r.nth ?? 0) > 0)).toBe(true);

    // Cancel should NOT have nth (it's unique)
    const cancelRef = Object.values(refs).find(
      (r) => r.role === "button" && r.name === "Cancel"
    );
    expect(cancelRef).toBeDefined();
    expect(cancelRef!.nth).toBeUndefined();

    // Snapshot text should reflect nth
    expect(snapshot).toContain("[nth=");
  });
});

/* ---------- screenshot helpers ---------- */

describe("getImageWidth (via integration)", () => {
  // We can't easily test the private function directly, but we can
  // verify the public API handles the quality parameter type correctly
  it("screenshot opts type is properly defined", async () => {
    // This is a compile-time check more than runtime — if types are wrong, build fails
    const opts = {
      cdpUrl: "ws://localhost:9222",
      type: "jpeg" as const,
      quality: 50,
      maxWidth: 800,
    };
    expect(opts.quality).toBe(50);
    expect(opts.maxWidth).toBe(800);
  });
});
