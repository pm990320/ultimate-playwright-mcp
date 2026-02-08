# Using Chrome for Testing with Extension Support

## Why Chrome for Testing?

Starting with Chrome 137, the `--load-extension` flag was removed from branded Chrome builds for security reasons. **Chrome for Testing** is a special distribution that still supports `--load-extension` for development and testing purposes.

## Installation Options

### Option 1: Via @puppeteer/browsers (Recommended)

The easiest way to install Chrome for Testing:

```bash
# Install latest stable
npx @puppeteer/browsers install chrome@stable

# Or install specific version
npx @puppeteer/browsers install chrome@131.0.6778.87
```

This installs Chrome for Testing to:
- **macOS**: `~/.cache/puppeteer/chrome/`
- **Linux**: `~/.cache/puppeteer/chrome/`
- **Windows**: `%USERPROFILE%\.cache\puppeteer\chrome\`

### Option 2: Direct Download

Download from the official Chrome for Testing dashboard:
- https://googlechromelabs.github.io/chrome-for-testing/

### Option 3: Via Playwright

If you have Playwright installed:

```bash
npx playwright install chromium
```

This installs to `~/Library/Caches/ms-playwright/chromium-*/` on macOS.

## Auto-Detection

The daemon automatically searches for Chrome for Testing in common locations:

1. **Puppeteer cache** (prioritized):
   - `~/.cache/puppeteer/chrome/*/chrome-mac/`

2. **Playwright cache**:
   - `~/Library/Caches/ms-playwright/chromium-*/`

3. **System installations**:
   - `/Applications/Google Chrome for Testing.app/`
   - `/Applications/Chromium.app/`
   - `/Applications/Google Chrome.app/` (fallback, no extension support in 137+)

The daemon will automatically use the first available Chrome for Testing installation.

## Manual Configuration

If you have Chrome for Testing in a custom location, specify it explicitly:

```json
{
  "mcpServers": {
    "ultimate-playwright": {
      "command": "node",
      "args": [
        "dist/cli.js",
        "--chrome-executable",
        "/path/to/chrome-for-testing",
        "--chrome-extensions",
        "nngceckbapebfimnlniiiahkandclblb"
      ]
    }
  }
}
```

Or via environment variable:

```bash
CHROME_EXECUTABLE=/path/to/chrome-for-testing node dist/cli.js
```

## Testing Extension Loading

After installation, test that extensions load correctly:

```bash
# Stop any running daemon
node dist/daemon/cli.js stop

# Test with Bitwarden extension
node dist/cli.js --chrome-extensions nngceckbapebfimnlniiiahkandclblb
```

Check the daemon logs to verify Chrome for Testing is being used:

```bash
tail -f /var/folders/*/T/ultimate-playwright-mcp-daemon.log
```

You should see:
```
Found Chrome at: /Users/.../.cache/puppeteer/chrome/.../Google Chrome for Testing
Loading extensions via --load-extension: /Users/.../.ultimate-playwright-mcp/extensions/nngceckbapebfimnlniiiahkandclblb
```

## Verifying Installation

Check if Chrome for Testing is installed:

```bash
# macOS/Linux
ls -la ~/.cache/puppeteer/chrome/

# Or check Playwright cache
ls -la ~/Library/Caches/ms-playwright/
```

## Common Extension IDs

For quick reference:

- **Bitwarden**: `nngceckbapebfimnlniiiahkandclblb`
- **uBlock Origin**: `cjpalhdlnbpafiamejdnhcphjbkeiagm`
- **Metamask**: `nkbihfbeogaeaoehlefnkodbefgpgknn`
- **LastPass**: `hdokiejnpimakedhajhdlcegeplioahd`

## Troubleshooting

### "Chrome not found" error

If the daemon can't find Chrome for Testing:

1. Install it via one of the methods above
2. Or specify the path explicitly with `--chrome-executable`

### Extensions not appearing

1. Make sure you're using Chrome for Testing (check logs)
2. Developer mode is auto-enabled, but verify in `chrome://extensions`
3. Check that extension downloaded correctly: `ls ~/.ultimate-playwright-mcp/extensions/`

### Using branded Chrome 137+ instead

If you prefer using regular Chrome 137+, you must install extensions manually once:

1. Open Chrome with profile: `open -a "Google Chrome" --args --user-data-dir=~/.ultimate-playwright-mcp/chrome-profile`
2. Navigate to `chrome://extensions/`, enable Developer Mode
3. Click "Load unpacked" and select extension directory
4. Extensions persist in that profile

## Additional Resources

- [Chrome for Testing Dashboard](https://googlechromelabs.github.io/chrome-for-testing/)
- [Puppeteer Browser Install Docs](https://pptr.dev/browsers-api/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
