# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-02-09

### Fixed

- Relaxed ESLint max-warnings for CI compatibility
- Added .npmrc to .gitignore

## [0.1.0] - 2026-02-09

### Added

- Initial release
- Tab group isolation for multi-agent browser sharing
- 10 MCP tools: tab_group, tabs, navigate, snapshot, click, type, hover, press_key, fill_form, wait_for
- CDP connection to existing Chrome instances
- Accessibility tree snapshots with element refs
- Chrome tab group extension for visual organization
- Persistent tab group registry (~/.ultimate-playwright-mcp/tab-groups.json)
