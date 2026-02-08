# Ultimate Playwright MCP - Implementation Plan

## Executive Summary

This project creates a multi-agent Playwright MCP server that allows multiple Claude instances (or other MCP clients) to share a single Chrome browser while maintaining isolated tab groups per agent. All agents share the same `BrowserContext`, enabling shared cookies and session state across agents.

---

## Problem Statement

The official `@playwright/mcp` has a fundamental limitation: when multiple parallel agents use the same MCP server, they fight over the same tab. The maintainers' position is that this is "the AI orchestrator's problem" ([Issue #893](https://github.com/microsoft/playwright-mcp/issues/893)).

**Current workarounds (all suboptimal):**
1. **Multiple MCP servers** with separate `--user-data-dir` → loses shared cookies/sessions
2. **Sequential execution** → slow, no parallelism

---

## Solution Architecture

### Approach: Extract OpenClaw's Browser Module

Rather than wrapping `@playwright/mcp`, we extract the battle-tested browser control code from [OpenClaw](https://github.com/openclaw/openclaw) (MIT licensed). Their `src/browser/` module already solves tab isolation via `targetId`.

**Why OpenClaw extraction (Approach B) wins:**
- Tab isolation already implemented and tested
- CDP connection with retry logic
- Page state tracking (console, errors, network)
- Role-based element refs (e1, e2, etc.) with snapshot
- Zero runtime dependencies beyond Playwright
- Full control - no daemon required

### Core Concept: Tab Isolation with `targetId` Parameter

Each tab has a unique CDP `targetId`. All browser operations include `targetId` to route to the correct tab:

```
┌─────────────────────────────────────────────────────────────┐
│                    Single Chrome Process                     │
│        (--remote-debugging-port=9222 or user profile)        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Single BrowserContext                       │ │
│  │                (shared cookies, storage)                 │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │ │
│  │  │ Tab 0   │ │ Tab 1   │ │ Tab 2   │ │ Tab 3   │ ...   │ │
│  │  │(Agent A)│ │(Agent A)│ │(Agent B)│ │(Agent C)│       │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                    CDP Connection
                              │
┌─────────────────────────────────────────────────────────────┐
│                  ultimate-playwright-mcp                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tab Routing Layer                         │  │
│  │  - Adds `tabId` parameter to all tab-aware tools       │  │
│  │  - Routes operations to specific tabs atomically       │  │
│  │  - Enhanced browser_tabs returns tabId on creation     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              MCP Server (stdio/SSE/HTTP)              │  │
│  │  - Wraps @playwright/mcp or re-implements tools       │  │
│  │  - Exposes standard MCP protocol                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
        │ Claude    │   │ Claude    │   │ Claude    │
        │ Code #1   │   │ Code #2   │   │ Desktop   │
        │ (Agent A) │   │ (Agent B) │   │ (Agent C) │
        └───────────┘   └───────────┘   └───────────┘
```

### Agent Workflow

```javascript
// Agent A creates and owns tab 0
browser_tabs({ action: "new" })  // Returns: tabId: 0
browser_navigate({ tabId: 0, url: "https://app.com/dashboard" })
browser_click({ tabId: 0, ref: "e1" })

// Agent B creates and owns tab 1, works in parallel
browser_tabs({ action: "new" })  // Returns: tabId: 1
browser_navigate({ tabId: 1, url: "https://app.com/settings" })
browser_type({ tabId: 1, ref: "e3", text: "new value" })

// Both agents share cookies - if Agent A logs in, Agent B sees the session
```

---

## Technical Decisions

### Decision 1: Implementation Approach

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Wrapper around `@playwright/mcp`** | Minimal code, upstream sync | Limited control, complex interception | ❌ |
| **OpenClaw Gateway + thin MCP wrapper** | 2 days effort, battle-tested | Extra daemon dependency | ❌ |
| **Extract OpenClaw browser module** | Full control, no deps, proven code | ~4-5 days effort | ✅ **Winner** |

**Chosen Approach: Extract OpenClaw Browser Module**

We extract the browser control stack from OpenClaw's `src/browser/` directory:
1. CDP session management with `targetId` → `Page` routing
2. All Playwright operations (click, type, snapshot, etc.)
3. Page state tracking (console, errors, network)
4. Wrap directly in MCP protocol (no HTTP layer)

### Decision 2: Browser Connection Strategy

| Strategy | Shared Cookies | Multiple MCP Clients | Complexity |
|----------|----------------|---------------------|------------|
| Launch browser per MCP | ❌ | ✅ (separate browsers) | Low |
| CDP to shared Chrome | ✅ | ✅ (same context) | Medium |
| Browser daemon + WebSocket | ✅ | ✅ (same context) | High |

**Chosen: CDP Connection to Shared Chrome**

- User launches Chrome with `--remote-debugging-port=9222` (e.g., via Launch Agent on macOS)
- MCP server connects via `chromium.connectOverCDP('http://localhost:9222')`
- All clients share the same `BrowserContext` → shared cookies automatically
- Each client creates its own tabs within that context

### Decision 3: What We Extract from OpenClaw

From `openclaw/src/browser/`:

| File | What It Does | Extract? |
|------|--------------|----------|
| `pw-session.ts` | CDP connection, `targetId`→`Page` routing, state tracking | ✅ Core |
| `pw-tools-core.interactions.ts` | click, type, hover, drag, select, fill | ✅ Core |
| `pw-tools-core.snapshot.ts` | Accessibility tree snapshot with refs | ✅ Core |
| `pw-tools-core.state.ts` | Console, errors, network state | ✅ Core |
| `pw-tools-core.activity.ts` | Wait conditions, navigation | ✅ Core |
| `pw-tools-core.storage.ts` | Cookies, localStorage | ✅ Core |
| `pw-role-snapshot.ts` | Role-based element refs (e1, e2) | ✅ Core |
| `target-id.ts` | TargetId resolution utility | ✅ Utility |
| `chrome.ts` | Chrome launcher (optional - we use CDP) | ⚠️ Optional |
| `profiles.ts` | Profile management | ❌ Skip |
| `extension-relay.ts` | Extension mode relay | ❌ Skip |
| `bridge-server.ts` | WebSocket bridge | ❌ Skip |

**Key functions from `pw-session.ts`:**
```typescript
// Connect to Chrome via CDP with retry logic
async function connectBrowser(cdpUrl: string): Promise<ConnectedBrowser>

// Get Page object by targetId - THE KEY FUNCTION
export async function getPageForTargetId(opts: {
  cdpUrl: string;
  targetId?: string;
}): Promise<Page>

// Create new tab, returns targetId for the agent to track
export async function createPageViaPlaywright(opts: {
  cdpUrl: string;
  url: string
}): Promise<{ targetId: string; title: string; url: string; }>

// List all tabs with targetIds
export async function listPagesViaPlaywright(opts: { cdpUrl: string }): Promise<
  Array<{ targetId: string; title: string; url: string; }>
>

// Close/focus tabs by targetId
export async function closePageByTargetIdViaPlaywright(opts)
export async function focusPageByTargetIdViaPlaywright(opts)

// Resolve ref (e1, e2) to Playwright locator
export function refLocator(page: Page, ref: string)
```

**Tab-aware tools** (get `targetId` parameter):
- `browser_snapshot`, `browser_click`, `browser_drag`, `browser_hover`
- `browser_select_option`, `browser_navigate`, `browser_navigate_back`
- `browser_press_key`, `browser_type`, `browser_fill_form`
- `browser_take_screenshot`, `browser_wait_for`, `browser_evaluate`
- `browser_console_messages`, `browser_network_requests`
- `browser_handle_dialog`, `browser_file_upload`
- `browser_resize`

**Enhanced `browser_tabs`** tool returns `targetId` on creation:
```javascript
// Response includes: "**targetId: ABC123...** - Use this with other browser tools."
```

---

## Project Structure

```
ultimate-playwright-mcp/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Lint, type-check, test on PR
│       └── release.yml         # Automated npm publish on tag
├── src/
│   ├── index.ts                # Main entry point, MCP server setup
│   ├── cli.ts                  # CLI entry point with commander
│   ├── browser/                # Extracted from OpenClaw (MIT)
│   │   ├── pw-session.ts       # CDP connection, targetId→Page routing
│   │   ├── pw-tools-core.ts    # Re-exports all tool modules
│   │   ├── pw-tools-interactions.ts  # click, type, hover, drag, select
│   │   ├── pw-tools-snapshot.ts      # Accessibility tree snapshot
│   │   ├── pw-tools-state.ts         # Console, errors, network
│   │   ├── pw-tools-activity.ts      # Wait, navigation
│   │   ├── pw-tools-storage.ts       # Cookies, localStorage
│   │   ├── pw-role-snapshot.ts       # Role-based refs (e1, e2)
│   │   └── target-id.ts              # TargetId resolution
│   ├── mcp/
│   │   ├── server.ts           # MCP server with tool registration
│   │   ├── tools/              # MCP tool definitions
│   │   │   ├── index.ts        # Tool registry
│   │   │   ├── tabs.ts         # browser_tabs (list, new, close, select)
│   │   │   ├── navigate.ts     # browser_navigate, browser_navigate_back
│   │   │   ├── snapshot.ts     # browser_snapshot
│   │   │   ├── actions.ts      # browser_click, type, hover, drag, etc.
│   │   │   ├── forms.ts        # browser_fill_form, browser_select_option
│   │   │   ├── state.ts        # browser_console_messages, network_requests
│   │   │   ├── storage.ts      # browser_cookies
│   │   │   └── screenshot.ts   # browser_take_screenshot
│   │   └── response-formatter.ts  # Format responses like Playwright MCP
│   └── config.ts               # Configuration types
├── tests/
│   ├── fixtures.ts             # Test fixtures
│   ├── testserver/             # Local test server
│   ├── tab-isolation.spec.ts   # Multi-agent tab isolation tests
│   ├── cdp-connection.spec.ts  # CDP connection tests
│   ├── shared-context.spec.ts  # Cookie/session sharing tests
│   └── tools.spec.ts           # Individual tool tests
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── eslint.config.js
├── CHANGELOG.md
├── README.md
└── plan.md                     # This file
```

---

## GitHub Actions Workflows

### 1. CI Workflow (`ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chromium, chrome]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install ${{ matrix.browser }} --with-deps
      - run: npm test -- --project=${{ matrix.browser }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-results-${{ matrix.browser }}
          path: test-results/
```

### 2. Release Workflow (`release.yml`)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm run build
      - run: npm test

      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
```

---

## Testing Strategy

### Test Categories

1. **Unit Tests** - Tab isolation logic
   ```typescript
   test('createTabProxyContext returns correct tab', async () => {
     const context = createMockContext([tab0, tab1, tab2]);
     const proxy = createTabProxyContext(context, 1);
     expect(proxy.currentTab()).toBe(tab1);
   });
   ```

2. **Integration Tests** - Multi-agent scenarios
   ```typescript
   test('parallel agents work on separate tabs', async ({ startClient }) => {
     const { client: agent1 } = await startClient({ clientName: 'agent1' });
     const { client: agent2 } = await startClient({ clientName: 'agent2' });

     // Agent 1 creates tab and navigates
     const tab1Result = await agent1.callTool({
       name: 'browser_tabs',
       arguments: { action: 'new' }
     });
     const tabId1 = extractTabId(tab1Result);

     await agent1.callTool({
       name: 'browser_navigate',
       arguments: { tabId: tabId1, url: server.PAGE_A }
     });

     // Agent 2 creates separate tab
     const tab2Result = await agent2.callTool({
       name: 'browser_tabs',
       arguments: { action: 'new' }
     });
     const tabId2 = extractTabId(tab2Result);

     await agent2.callTool({
       name: 'browser_navigate',
       arguments: { tabId: tabId2, url: server.PAGE_B }
     });

     // Verify isolation - agent1's tab still on PAGE_A
     const snapshot1 = await agent1.callTool({
       name: 'browser_snapshot',
       arguments: { tabId: tabId1 }
     });
     expect(snapshot1).toContain('Page A Content');
   });
   ```

3. **Shared Context Tests** - Cookie/session sharing
   ```typescript
   test('cookies are shared between agents', async ({ startClient, server }) => {
     server.setRoute('/set-cookie', (req, res) => {
       res.setHeader('Set-Cookie', 'session=abc123; Path=/');
       res.end('Cookie set');
     });

     server.setRoute('/check-cookie', (req, res) => {
       res.end(`Cookie: ${req.headers.cookie}`);
     });

     const { client: agent1 } = await startClient();
     const { client: agent2 } = await startClient();

     // Agent 1 sets cookie
     await agent1.callTool({
       name: 'browser_navigate',
       arguments: { tabId: 0, url: server.PREFIX + '/set-cookie' }
     });

     // Agent 2 sees the cookie (shared context)
     const result = await agent2.callTool({
       name: 'browser_navigate',
       arguments: { tabId: 1, url: server.PREFIX + '/check-cookie' }
     });
     expect(result).toContain('session=abc123');
   });
   ```

4. **CDP Connection Tests**
   ```typescript
   test('connects to existing Chrome via CDP', async ({ cdpServer, startClient }) => {
     await cdpServer.start();

     const { client } = await startClient({
       args: [`--cdp-endpoint=${cdpServer.endpoint}`]
     });

     const result = await client.callTool({
       name: 'browser_navigate',
       arguments: { url: 'https://example.com' }
     });

     expect(result).not.toContain('Error');
   });
   ```

5. **Upstream Compatibility Tests**
   - Run original upstream test suite
   - Verify all tools work without `tabId` (backward compatible)

### Test Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  projects: [
    {
      name: 'chromium',
      use: { mcpBrowser: 'chromium' },
    },
    {
      name: 'chrome',
      use: { mcpBrowser: 'chrome' },
    },
    {
      name: 'chrome-cdp',
      use: {
        mcpBrowser: 'chrome',
        mcpArgs: ['--cdp-endpoint=http://localhost:9222']
      },
    },
  ],

  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],
});
```

---

## Implementation Phases

### Phase 1: Foundation (Day 1)
- [ ] Initialize repository with TypeScript + ESLint config
- [ ] Set up Playwright test infrastructure
- [ ] Extract `pw-session.ts` from OpenClaw (CDP connection, targetId routing)
- [ ] Write first test: CDP connection works

### Phase 2: Core Browser Operations (Day 2)
- [ ] Extract `pw-tools-interactions.ts` (click, type, hover, drag)
- [ ] Extract `pw-tools-snapshot.ts` and `pw-role-snapshot.ts`
- [ ] Extract `target-id.ts` utility
- [ ] Test: can perform actions on specific tab by targetId

### Phase 3: MCP Server (Day 3)
- [ ] Implement MCP server using `@modelcontextprotocol/sdk`
- [ ] Implement `browser_tabs` tool (list, new, close, select) with targetId
- [ ] Implement `browser_navigate` and `browser_snapshot` tools
- [ ] Test: basic navigation and snapshot work

### Phase 4: Complete Tool Set (Day 4)
- [ ] Implement action tools: click, type, hover, drag, select, fill
- [ ] Implement state tools: console_messages, network_requests, cookies
- [ ] Implement screenshot tool
- [ ] Format responses to match Playwright MCP style

### Phase 5: Multi-Agent Testing (Day 5)
- [ ] Write multi-agent isolation tests
- [ ] Test cookie/session sharing between agents
- [ ] Test parallel operations don't interfere
- [ ] Edge cases: tab closed by user, invalid targetId

### Phase 6: CLI & Release (Day 6)
- [ ] Implement CLI with `--cdp-endpoint` option
- [ ] Set up GitHub Actions CI
- [ ] Prepare package.json for npm
- [ ] Write README with usage examples
- [ ] First npm publish

---

## Configuration Reference

```typescript
// Extended config (inherits all upstream options)
interface UltimateConfig extends Config {
  /**
   * Tab isolation settings
   */
  tabIsolation?: {
    /**
     * Require tabId on all tab-aware tool calls.
     * Useful for strict multi-agent environments.
     * Default: false (backward compatible)
     */
    requireTabId?: boolean;

    /**
     * Automatically assign tab to new MCP client connections.
     * Only works with SSE/HTTP transport.
     * Default: false
     */
    autoAssignTab?: boolean;
  };

  /**
   * Agent identification for logging/debugging
   */
  agentId?: string;
}
```

### CLI Options

```bash
# All upstream options supported, plus:
ultimate-playwright-mcp \
  --cdp-endpoint http://localhost:9222 \  # Connect to existing Chrome
  --require-tab-id \                       # Strict mode: tabId required
  --agent-id "agent-1"                     # For logging
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "ultimate-playwright-mcp@latest",
        "--cdp-endpoint", "http://localhost:9222"
      ]
    }
  }
}
```

---

## Chrome Launch Setup (macOS)

For persistent Chrome with CDP enabled:

```xml
<!-- ~/Library/LaunchAgents/com.user.chrome-debug.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.chrome-debug</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
        <string>--remote-debugging-port=9222</string>
        <string>--user-data-dir=/Users/patrick/chrome-debug-profile</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.user.chrome-debug.plist`

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Upstream breaks our wrappers | Medium | High | Weekly sync, comprehensive tests, pin playwright version |
| CDP connection instability | Low | Medium | Reconnection logic, fallback to launch mode |
| Tab index drift (tabs closed by user) | Medium | Medium | Validate tabId before operations, clear error messages |
| Performance overhead from proxying | Low | Low | Profile critical paths, optimize if needed |
| Claude Code fails to resolve conflicts | Medium | Medium | Manual fallback documented, simple conflict patterns |

---

## Success Metrics

1. **Functional**: Multiple Claude Code instances can work in parallel without interference
2. **Performance**: < 5ms overhead per tool call from tab routing
3. **Compatibility**: 100% upstream test suite passes
4. **Adoption**: Seamless drop-in replacement for `@playwright/mcp`
5. **Maintenance**: < 1 hour per upstream sync (automated when clean)

---

## License & Attribution

This project extracts browser control code from [OpenClaw](https://github.com/openclaw/openclaw), which is MIT licensed. The extracted code is modified to work as a standalone MCP server.

**Attribution in source files:**
```typescript
/**
 * Extracted from OpenClaw (https://github.com/openclaw/openclaw)
 * Original: src/browser/pw-session.ts
 * License: MIT
 *
 * Modified for ultimate-playwright-mcp:
 * - Removed HTTP server dependencies
 * - Simplified for MCP-only use
 */
```

---

## References

- [OpenClaw](https://github.com/openclaw/openclaw) - Source of browser control code (MIT license)
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - Official Playwright MCP (tool interface reference)
- [Issue #893](https://github.com/microsoft/playwright-mcp/issues/893) - Multi-agent interference discussion
- [Playwright CDP docs](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) - CDP connection API
- [MCP Specification](https://spec.modelcontextprotocol.io/) - Model Context Protocol spec
