/**
 * Configuration for ultimate-playwright-mcp server
 */

export interface ServerConfig {
  /**
   * CDP endpoint URL (e.g., "http://localhost:9222")
   * If not provided, the Chrome daemon will be auto-started on localhost:9223
   */
  cdpEndpoint?: string;

  /**
   * Optional agent ID for logging/debugging
   */
  agentId?: string;

  /**
   * Chrome user data directory (profile directory)
   * Default: ~/.ultimate-playwright-mcp/chrome-profile
   */
  chromeUserDataDir?: string;

  /**
   * Chrome extensions to load:
   * - Chrome Web Store IDs (32 lowercase letters, e.g., "nngceckbapebfimnlniiiahkandclblb" for Bitwarden)
   * - Local paths to unpacked extensions (absolute or relative paths)
   * Extensions from the store will be automatically downloaded and extracted.
   */
  chromeExtensions?: string[];

  /**
   * Chrome executable path (auto-detected if not provided)
   */
  chromeExecutable?: string;
}

export function validateConfig(_config: ServerConfig): void {
  // Config is always valid now - daemon will auto-start if needed
}
