#!/usr/bin/env node

/**
 * Chrome Daemon - Singleton process that manages Chrome browser
 * Ensures only one Chrome instance runs and keeps it alive
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { globSync } from "glob";
import { resolveExtensions } from "../utils/extension-installer.js";

const DAEMON_LOCK_FILE = path.join(os.tmpdir(), "ultimate-playwright-mcp-daemon.lock");
const DAEMON_LOG_FILE = path.join(os.tmpdir(), "ultimate-playwright-mcp-daemon.log");
const CDP_PORT = 9223; // Use dedicated port to avoid conflicts with existing Chrome
const DEFAULT_CHROME_PROFILE = path.join(os.homedir(), ".ultimate-playwright-mcp", "chrome-profile");

interface ChromeDaemonConfig {
  chromeUserDataDir?: string;
  chromeExtensions?: string[];
  chromeExecutable?: string;
}

class ChromeDaemon {
  private chromeProcess: ChildProcess | null = null;
  private shuttingDown = false;
  private config: ChromeDaemonConfig;

  constructor(config?: ChromeDaemonConfig) {
    this.config = config || {};
  }

  async start() {
    // Check if daemon is already running
    if (this.isDaemonRunning()) {
      this.log("Daemon already running, exiting");
      process.exit(0);
    }

    // Create lock file
    this.createLockFile();

    // Handle cleanup on exit
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
    process.on("exit", () => this.cleanup());

    this.log("Chrome daemon started");

    // Start Chrome and keep it alive
    await this.ensureChromeRunning();

    // Monitor Chrome process
    setInterval(() => this.ensureChromeRunning(), 5000);
  }

  private isDaemonRunning(): boolean {
    if (!fs.existsSync(DAEMON_LOCK_FILE)) {
      return false;
    }

    try {
      const pid = parseInt(fs.readFileSync(DAEMON_LOCK_FILE, "utf-8").trim());
      // Check if process is still running
      process.kill(pid, 0);
      return true;
    } catch {
      // Process not running, remove stale lock file
      fs.unlinkSync(DAEMON_LOCK_FILE);
      return false;
    }
  }

  private createLockFile() {
    fs.writeFileSync(DAEMON_LOCK_FILE, String(process.pid));
  }

  private async ensureChromeRunning() {
    if (this.chromeProcess && !this.chromeProcess.killed) {
      return; // Chrome is running
    }

    // Always launch our own Chrome (don't reuse existing instances)
    this.log("Starting Chrome...");
    await this.startChrome();
  }

  private async isChromeReachable(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async startChrome() {
    const chromePath = this.config.chromeExecutable || this.findChromePath();
    if (!chromePath) {
      this.log("ERROR: Chrome not found");
      return;
    }

    // Use configured profile or default persistent profile
    const userDataDir = this.config.chromeUserDataDir || DEFAULT_CHROME_PROFILE;

    // Ensure user data directory exists
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      this.log(`Created Chrome profile directory: ${userDataDir}`);
    }

    // Enable developer mode for extensions if loading extensions
    if (this.config.chromeExtensions && this.config.chromeExtensions.length > 0) {
      this.enableDeveloperMode(userDataDir);
    }

    const args = [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-startup-window",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--download-default-directory=${path.join(os.homedir(), "Downloads")}`,
    ];

    // Add extensions if configured (requires Chrome for Testing)
    if (this.config.chromeExtensions && this.config.chromeExtensions.length > 0) {
      try {
        const extensionPaths = await resolveExtensions(this.config.chromeExtensions);
        if (extensionPaths.length > 0) {
          const pathsStr = extensionPaths.join(",");
          args.push(`--load-extension=${pathsStr}`);
          this.log(`Loading extensions: ${pathsStr}`);

          // Warn if using branded Chrome 137+
          if (chromePath.includes("Google Chrome.app") && !chromePath.includes("Chrome for Testing")) {
            this.log("WARNING: Using branded Chrome may not support --load-extension in version 137+");
            this.log("         Recommend installing Chrome for Testing for guaranteed extension support");
          }
        }
      } catch (error) {
        this.log(`WARNING: Failed to resolve extensions: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: "ignore",
    });

    this.chromeProcess.on("exit", (code) => {
      this.log(`Chrome exited with code ${code}`);
      this.chromeProcess = null;
      if (!this.shuttingDown) {
        this.log("Chrome crashed, will restart...");
      }
    });

    this.chromeProcess.unref();
    this.log(`Chrome started (PID: ${this.chromeProcess.pid})`);

    // Wait for Chrome to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await this.isChromeReachable()) {
        this.log("Chrome is ready");
        return;
      }
    }

    this.log("WARNING: Chrome started but not responding on CDP port");
  }

  private enableDeveloperMode(userDataDir: string) {
    const prefsPath = path.join(userDataDir, "Default", "Preferences");
    const defaultDir = path.join(userDataDir, "Default");

    try {
      // Ensure Default directory exists
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
      }

      // Read existing preferences or create new
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chrome prefs JSON has deeply nested dynamic structure
      let prefs: Record<string, any> = {};
      if (fs.existsSync(prefsPath)) {
        const prefsContent = fs.readFileSync(prefsPath, "utf-8");
        prefs = JSON.parse(prefsContent);
      }

      // Set developer mode for extensions
      if (!prefs.extensions) {
        prefs.extensions = {};
      }
      if (!prefs.extensions.ui) {
        prefs.extensions.ui = {};
      }
      prefs.extensions.ui.developer_mode = true;

      // Write preferences
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
      this.log("Enabled developer mode for extensions");
    } catch (error) {
      this.log(`Warning: Could not enable developer mode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private findChromePath(): string | null {
    const platform = process.platform;
    const paths: string[] = [];

    if (platform === "darwin") {
      // Chrome for Testing locations (prioritized for --load-extension support)
      paths.push(
        path.join(os.homedir(), ".cache/puppeteer/chrome/mac_arm-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        path.join(os.homedir(), ".cache/puppeteer/chrome/mac-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        // Chromium and standard Chrome (fallback, may not support --load-extension)
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Comet.app/Contents/MacOS/Comet"
      );
    } else if (platform === "linux") {
      paths.push(
        path.join(os.homedir(), ".cache/puppeteer/chrome/linux-*/chrome-linux*/chrome"),
        path.join(os.homedir(), ".cache/ms-playwright/chromium-*/chrome-linux/chrome"),
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome"
      );
    } else if (platform === "win32") {
      paths.push(
        path.join(os.homedir(), ".cache\\puppeteer\\chrome\\win64-*\\chrome-win64\\chrome.exe"),
        path.join(os.homedir(), ".cache\\ms-playwright\\chromium-*\\chrome-win\\chrome.exe"),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      );
    }

    // Resolve glob patterns and find first existing path
    for (const pathPattern of paths) {
      if (pathPattern.includes("*")) {
        // Use glob to resolve wildcards
        const matches = globSync(pathPattern);
        if (matches.length > 0) {
          // Sort to get latest version
          matches.sort().reverse();
          if (fs.existsSync(matches[0])) {
            this.log(`Found Chrome at: ${matches[0]}`);
            return matches[0];
          }
        }
      } else if (fs.existsSync(pathPattern)) {
        this.log(`Found Chrome at: ${pathPattern}`);
        return pathPattern;
      }
    }

    return null;
  }

  private shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.log("Shutting down daemon...");

    if (this.chromeProcess && !this.chromeProcess.killed) {
      this.log("Stopping Chrome...");
      this.chromeProcess.kill();
    }

    this.cleanup();
    process.exit(0);
  }

  private cleanup() {
    if (fs.existsSync(DAEMON_LOCK_FILE)) {
      fs.unlinkSync(DAEMON_LOCK_FILE);
    }
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    // Log to console
    console.error(logLine.trim());

    // Log to file
    fs.appendFileSync(DAEMON_LOG_FILE, logLine);
  }
}

// Parse CLI args with commander (only runs if this file is executed directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const { program } = await import("commander");

  program
    .name("chrome-daemon")
    .description("Chrome daemon process for ultimate-playwright-mcp")
    .version("0.1.0")
    .option("--config <json>", "Configuration JSON string")
    .parse();

  const options = program.opts();
  let daemonConfig: ChromeDaemonConfig | undefined;

  if (options.config) {
    try {
      daemonConfig = JSON.parse(options.config);
    } catch (e) {
      console.error('Failed to parse daemon config:', e);
    }
  }

  // Start daemon
  const daemon = new ChromeDaemon(daemonConfig);
  daemon.start();
}
