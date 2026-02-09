# Ultimate Playwright MCP

[![npm version](https://img.shields.io/npm/v/ultimate-playwright-mcp)](https://www.npmjs.com/package/ultimate-playwright-mcp)
[![npm downloads](https://img.shields.io/npm/dm/ultimate-playwright-mcp)](https://www.npmjs.com/package/ultimate-playwright-mcp)
[![license](https://img.shields.io/npm/l/ultimate-playwright-mcp)](https://github.com/pm990320/ultimate-playwright-mcp/blob/main/LICENSE)
[![CI](https://github.com/pm990320/ultimate-playwright-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pm990320/ultimate-playwright-mcp/actions/workflows/ci.yml)

Multi-agent Playwright MCP server with tab isolation via `targetId`. Allows multiple Claude instances (or other MCP clients) to share a single Chrome browser while maintaining isolated tab groups.

## Why Ultimate Playwright?

The official [`@playwright/mcp`](https://github.com/nickmccurdy/playwright-mcp) gives you browser control for a **single agent**. But what if you have **multiple agents** sharing one browser?

**Ultimate Playwright MCP** solves this with **tab group isolation**:

- 🔀 **Multi-agent tab groups** — Each agent creates a `groupId` and only sees its own tabs
- 🍪 **Shared cookies & sessions** — All agents share the same BrowserContext (log in once, everyone's authenticated)
- 🎨 **Visual Chrome tab groups** — Companion extension organizes tabs into color-coded Chrome tab groups
- 💾 **Persistent registry** — Tab groups survive MCP server restarts (`~/.ultimate-playwright-mcp/tab-groups.json`)
- 🔌 **Connect to existing Chrome** — Uses CDP to attach to your running Chrome (keeps your profile, extensions, bookmarks)

### Comparison

| Feature | **ultimate-playwright-mcp** | @playwright/mcp | browser-use-mcp |
|---|---|---|---|
| Multi-agent tab isolation | ✅ Tab groups with `groupId` | ❌ Single session | ❌ Single session |
| Shared cookies across agents | ✅ Same BrowserContext | N/A | N/A |
| Connect to existing Chrome | ✅ CDP | ❌ Launches new browser | ❌ Launches new browser |
| Visual tab groups in Chrome | ✅ Extension | ❌ | ❌ |
| Persistent tab registry | ✅ Survives restarts | ❌ | ❌ |
| Accessibility tree snapshots | ✅ Element refs (e1, e2…) | ✅ | ❌ Screenshot-based |
| Open source | ✅ MIT | ✅ Apache-2.0 | ✅ MIT |

## Features

- ✅ **Tab Isolation** - Each agent gets its own tabs via unique `targetId`
- ✅ **Shared Cookies** - All agents share the same BrowserContext (cookies, sessions, localStorage)
- ✅ **Parallel Execution** - Multiple agents can operate simultaneously without interference
- ✅ **CDP Connection** - Connects to existing Chrome via Chrome DevTools Protocol
- ✅ **Battle-Tested** - Extracted from [OpenClaw](https://github.com/openclaw/openclaw) (MIT licensed)

## Installation

```bash
npm install -g ultimate-playwright-mcp
```

Or run directly with npx:

```bash
npx ultimate-playwright-mcp --cdp-endpoint http://localhost:9222
```

## Quick Start

### 1. Launch Chrome with Remote Debugging

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Windows
"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\\temp\\chrome-debug
```

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ultimate-playwright": {
      "command": "npx",
      "args": [
        "ultimate-playwright-mcp",
        "--cdp-endpoint",
        "http://localhost:9222"
      ]
    }
  }
}
```

### 3. Restart Claude Desktop

Claude will now have access to browser control tools with tab isolation.

## Usage Example

```
User: Open two tabs and navigate them independently

Claude: I'll create two tabs with separate targetIds:

1. browser_tabs({ action: "new" })
   → **targetId: ABC123...**

2. browser_tabs({ action: "new" })
   → **targetId: XYZ789...**

3. browser_navigate({ targetId: "ABC123...", url: "https://github.com" })
4. browser_navigate({ targetId: "XYZ789...", url: "https://google.com" })

Both tabs are now navigated independently!
```

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `browser_tab_group` | Create/list/delete tab groups for isolation | `action`, `name`, `color`, `groupId` |
| `browser_tabs` | List, create, close, or select tabs | `action`, `groupId`, `targetId`, `index` |
| `browser_navigate` | Navigate to a URL | `url`, `targetId` |
| `browser_snapshot` | Capture accessibility tree with refs | `targetId` |
| `browser_click` | Click an element | `ref`, `targetId` |
| `browser_type` | Type text into an element | `ref`, `text`, `targetId` |
| `browser_hover` | Hover over an element | `ref`, `targetId` |
| `browser_press_key` | Press a keyboard key | `key`, `targetId` |
| `browser_fill_form` | Fill multiple form fields | `fields`, `targetId` |
| `browser_wait_for` | Wait for conditions | `text`, `selector`, `url`, `loadState`, `targetId` |

## Tab Groups (Multi-User Isolation)

When multiple users or agents share one browser instance, tab groups keep everyone's
tabs isolated. Each session creates its own group, and all tab operations are scoped
to that group.

```
User: Research product pricing

Claude: I'll create a tab group first, then open tabs within it.

1. browser_tab_group({ action: "create", name: "pricing-research", color: "blue" })
   → **groupId: g_a1b2c3d4e5f6**

2. browser_tabs({ action: "new", groupId: "g_a1b2c3d4e5f6", url: "https://example.com/pricing" })
   → **targetId: ABC123...**

3. browser_tabs({ action: "list", groupId: "g_a1b2c3d4e5f6" })
   → Only shows tabs in this group (not other users' tabs)
```

Meanwhile, another user on the same server:

```
1. browser_tab_group({ action: "create", name: "docs-review", color: "green" })
   → **groupId: g_x9y8z7w6v5u4**

2. browser_tabs({ action: "new", groupId: "g_x9y8z7w6v5u4", url: "https://docs.example.com" })
   → **targetId: XYZ789...**
```

Both users share the same cookies/sessions but only see their own tabs!

### Tab Group Lifecycle

1. **Create** a group at the start of your session
2. **Open tabs** within the group using `groupId`
3. **Work** with tabs using `targetId` as before
4. **Delete** the group when done (optionally closes all tabs)

Group state is persisted to `~/.ultimate-playwright-mcp/tab-groups.json` so it
survives MCP server restarts.

## Architecture

```
┌─────────────────────────────────────────────┐
│        Single Chrome Process                │
│    (--remote-debugging-port=9222)           │
│  ┌─────────────────────────────────────┐   │
│  │     Single BrowserContext            │   │
│  │  (shared cookies, storage)           │   │
│  │                                      │   │
│  │  Group: alice (blue)                 │   │
│  │  ┌─────┐ ┌─────┐                    │   │
│  │  │ Tab │ │ Tab │                    │   │
│  │  │  A  │ │  B  │                    │   │
│  │  └─────┘ └─────┘                    │   │
│  │                                      │   │
│  │  Group: bob (green)                  │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐            │   │
│  │  │ Tab │ │ Tab │ │ Tab │            │   │
│  │  │  C  │ │  D  │ │  E  │            │   │
│  │  └─────┘ └─────┘ └─────┘            │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
                   ↑
           CDP Connection
                   ↓
┌─────────────────────────────────────────────┐
│    ultimate-playwright-mcp (MCP Server)     │
│    - Tab routing via targetId               │
│    - Tab groups via groupId                 │
│    - Shared ownership registry (JSON file)  │
│    - Stdio transport                        │
└─────────────────────────────────────────────┘
         ↓           ↓           ↓
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Alice   │ │  Bob    │ │ Charlie │
   │ (Claude)│ │ (Claude)│ │ (Cursor)│
   └─────────┘ └─────────┘ └─────────┘
```

## MCP Configuration

### Cursor / Windsurf / Generic MCP Client

```json
{
  "mcpServers": {
    "ultimate-playwright": {
      "command": "npx",
      "args": ["ultimate-playwright-mcp", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

### With Environment Variable

```json
{
  "mcpServers": {
    "ultimate-playwright": {
      "command": "npx",
      "args": ["ultimate-playwright-mcp"],
      "env": {
        "CDP_ENDPOINT": "http://localhost:9222"
      }
    }
  }
}
```

## CLI Options

```bash
ultimate-playwright-mcp [options]

Options:
  --cdp-endpoint <url>  CDP endpoint URL (e.g., http://localhost:9222)
                        Can also use CDP_ENDPOINT env var
  --agent-id <id>       Optional agent ID for logging/debugging
                        Can also use AGENT_ID env var
  -V, --version         Output version number
  -h, --help            Display help
```

## Multi-Agent Setup

### Running Multiple Claude Code Instances

Each instance connects to the same MCP server and gets isolated tabs:

**Terminal 1:**
```bash
claude-code --mcp-config ./mcp-config.json
# Agent A creates tabs with targetIds starting from ABC...
```

**Terminal 2:**
```bash
claude-code --mcp-config ./mcp-config.json
# Agent B creates tabs with targetIds starting from XYZ...
```

Both agents share cookies and sessions but operate on different tabs!

## Persistent Chrome Setup (macOS)

For a Chrome instance that auto-starts with debug port:

Create `~/Library/LaunchAgents/com.user.chrome-debug.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.chrome-debug</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
        <string>--remote-debugging-port=9222</string>
        <string>--user-data-dir=/Users/YOUR_USERNAME/chrome-debug-profile</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.user.chrome-debug.plist
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Type check
npm run type-check

# Lint
npm run lint

# Watch mode
npm run watch
```

## License

MIT

## Attribution

This project extracts browser control code from [OpenClaw](https://github.com/openclaw/openclaw) (MIT licensed), which provides battle-tested tab isolation and Playwright integration.

Key extracted components:
- CDP session management (`pw-session.ts`)
- Browser operations (`pw-tools-*.ts`)
- Role-based element refs (`pw-role-snapshot.ts`)

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) - Source of browser control code
- [MCP Specification](https://spec.modelcontextprotocol.io/) - Model Context Protocol
- [Playwright](https://playwright.dev/) - Browser automation library
