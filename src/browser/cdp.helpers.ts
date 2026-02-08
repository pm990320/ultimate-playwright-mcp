/**
 * Extracted from OpenClaw (https://github.com/openclaw/openclaw)
 * Original: src/browser/cdp.helpers.ts
 * License: MIT
 *
 * Modified for ultimate-playwright-mcp:
 * - Removed WebSocket-based CDP sender (Playwright handles this)
 * - Removed extension relay dependencies
 * - Kept only URL/auth helpers needed by pw-session.ts
 */

export function isLoopbackHost(host: string) {
  const h = host.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "[::]" ||
    h === "::"
  );
}

export function getHeadersWithAuth(url: string, headers: Record<string, string> = {}) {
  try {
    const parsed = new URL(url);
    const hasAuthHeader = Object.keys(headers).some(
      (key) => key.toLowerCase() === "authorization",
    );
    if (hasAuthHeader) {
      return headers;
    }
    if (parsed.username || parsed.password) {
      const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64");
      return { ...headers, Authorization: `Basic ${auth}` };
    }
  } catch {
    // ignore
  }
  return headers;
}
