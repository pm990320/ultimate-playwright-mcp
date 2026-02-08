/**
 * Main entry point for ultimate-playwright-mcp
 * Exports server creation function for programmatic use
 */

export { createMCPServer, runServer } from "./mcp/server.js";
export type { ServerConfig } from "./config.js";
export { validateConfig } from "./config.js";

// Re-export browser functions for advanced use cases
export {
  getPageForTargetId,
  listPagesViaPlaywright,
  createPageViaPlaywright,
  closePageByTargetIdViaPlaywright,
  focusPageByTargetIdViaPlaywright,
} from "./browser/pw-session.js";
