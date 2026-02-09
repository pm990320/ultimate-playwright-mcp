#!/usr/bin/env node

/**
 * CLI entry point for ultimate-playwright-mcp
 */

import { program } from "commander";
import { runServer } from "./mcp/server.js";
import type { ServerConfig } from "./config.js";
import { validateConfig } from "./config.js";

program
  .name("ultimate-playwright-mcp")
  .description("Multi-agent Playwright MCP server with tab isolation via targetId")
  .version("0.1.0")
  .option(
    "--cdp-endpoint <url>",
    "CDP endpoint URL (default: auto-start daemon on localhost:9223)",
    process.env.CDP_ENDPOINT
  )
  .option("--agent-id <id>", "Optional agent ID for logging/debugging", process.env.AGENT_ID)
  .option(
    "--chrome-user-data-dir <path>",
    "Chrome profile directory (default: ~/.ultimate-playwright-mcp/chrome-profile)",
    process.env.CHROME_USER_DATA_DIR
  )
  .option(
    "--chrome-extensions <ids>",
    "Chrome Web Store extension IDs (comma-separated)",
    process.env.CHROME_EXTENSIONS
  )
  .option(
    "--chrome-executable <path>",
    "Path to Chrome executable (auto-detected if not provided)",
    process.env.CHROME_EXECUTABLE
  )
  .option(
    "--download-dir <path>",
    "Download directory for Chrome (default: ~/Downloads)",
    process.env.DOWNLOAD_DIR
  )
  .action(async (options) => {
    const config: ServerConfig = {
      cdpEndpoint: options.cdpEndpoint,
      agentId: options.agentId,
      chromeUserDataDir: options.chromeUserDataDir,
      chromeExtensions: options.chromeExtensions?.split(",").map((s: string) => s.trim()).filter(Boolean),
      chromeExecutable: options.chromeExecutable,
      downloadDir: options.downloadDir,
    };

    try {
      validateConfig(config);
      await runServer(config);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
