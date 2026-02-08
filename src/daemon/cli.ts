#!/usr/bin/env node

/**
 * Daemon CLI - Manually control Chrome daemon
 */

import { program } from "commander";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DAEMON_LOCK_FILE = path.join(os.tmpdir(), "ultimate-playwright-mcp-daemon.lock");
const DAEMON_LOG_FILE = path.join(os.tmpdir(), "ultimate-playwright-mcp-daemon.log");

function isDaemonRunning(): boolean {
  if (!fs.existsSync(DAEMON_LOCK_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(DAEMON_LOCK_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    fs.unlinkSync(DAEMON_LOCK_FILE);
    return false;
  }
}

function getDaemonPid(): number | null {
  if (!fs.existsSync(DAEMON_LOCK_FILE)) {
    return null;
  }
  return parseInt(fs.readFileSync(DAEMON_LOCK_FILE, "utf-8").trim());
}

function startDaemon() {
  if (isDaemonRunning()) {
    console.log("Daemon already running (PID:", getDaemonPid() + ")");
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const daemonScript = path.join(__dirname, "chrome-daemon.js");

  const daemon = spawn("node", [daemonScript], {
    detached: true,
    stdio: "ignore",
  });

  daemon.unref();
  console.log("Chrome daemon started (PID:", daemon.pid + ")");
  console.log("Log file:", DAEMON_LOG_FILE);
}

function stopDaemon() {
  const pid = getDaemonPid();
  if (!pid) {
    console.log("Daemon not running");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log("Daemon stopped (PID:", pid + ")");
  } catch (error) {
    console.error("Failed to stop daemon:", error);
  }
}

function statusDaemon() {
  const pid = getDaemonPid();
  if (!pid) {
    console.log("Status: Not running");
    return;
  }

  console.log("Status: Running");
  console.log("PID:", pid);
  console.log("Lock file:", DAEMON_LOCK_FILE);
  console.log("Log file:", DAEMON_LOG_FILE);
}

function showLogs() {
  if (!fs.existsSync(DAEMON_LOG_FILE)) {
    console.log("No logs found");
    return;
  }

  const logs = fs.readFileSync(DAEMON_LOG_FILE, "utf-8");
  console.log(logs);
}

program
  .name("upmcp-daemon")
  .description("Chrome Daemon Control for ultimate-playwright-mcp")
  .version("0.1.0");

program
  .command("start")
  .description("Start the Chrome daemon")
  .action(startDaemon);

program
  .command("stop")
  .description("Stop the Chrome daemon")
  .action(stopDaemon);

program
  .command("restart")
  .description("Restart the Chrome daemon")
  .action(() => {
    stopDaemon();
    setTimeout(startDaemon, 1000);
  });

program
  .command("status")
  .description("Show daemon status")
  .action(statusDaemon);

program
  .command("logs")
  .description("Show daemon logs")
  .action(showLogs);

program.parse();
