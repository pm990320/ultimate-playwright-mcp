/**
 * Daemon manager - Ensures Chrome daemon is running before MCP server starts
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DAEMON_LOCK_FILE = path.join(os.tmpdir(), "ultimate-playwright-mcp-daemon.lock");
const CDP_PORT = 9223; // Use dedicated port to avoid conflicts with existing Chrome

export interface DaemonConfig {
  chromeUserDataDir?: string;
  chromeExtensions?: string[];
  chromeExecutable?: string;
  downloadDir?: string;
}

export class DaemonManager {
  /**
   * Ensure daemon is running, start if needed
   */
  static async ensureDaemonRunning(config?: DaemonConfig): Promise<void> {
    // Check if daemon is already running
    if (this.isDaemonRunning()) {
      console.error("✓ Chrome daemon already running");
      return;
    }

    console.error("Starting Chrome daemon...");
    await this.startDaemon(config);

    // Wait for daemon to be ready
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await this.isChromeReachable()) {
        console.error("✓ Chrome daemon ready");
        return;
      }
    }

    throw new Error("Chrome daemon failed to start within 30 seconds");
  }

  private static isDaemonRunning(): boolean {
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

  private static async startDaemon(config?: DaemonConfig): Promise<void> {
    // Find the daemon script path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const daemonScript = path.join(__dirname, "chrome-daemon.js");

    if (!fs.existsSync(daemonScript)) {
      throw new Error(
        `Daemon script not found: ${daemonScript}\n` +
        "Make sure to run 'npm run build' first"
      );
    }

    // Prepare daemon args with config
    const args = [daemonScript];
    if (config) {
      args.push(`--config=${JSON.stringify(config)}`);
    }

    // Start daemon as detached process
    const daemon = spawn("node", args, {
      detached: true,
      stdio: "ignore",
    });

    daemon.unref();
    console.error(`Chrome daemon started (PID: ${daemon.pid})`);
  }

  private static async isChromeReachable(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get CDP endpoint URL
   */
  static getCdpEndpoint(): string {
    return `http://localhost:${CDP_PORT}`;
  }
}
