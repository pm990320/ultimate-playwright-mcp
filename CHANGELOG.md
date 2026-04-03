# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/pm990320/ultimate-playwright-mcp/compare/v0.1.3...v0.2.0) (2026-04-03)


### Features

* comprehensive stealth script injection ([6588548](https://github.com/pm990320/ultimate-playwright-mcp/commit/658854878d6ce1a6c19695567646401299249d50))
* expose snapshot filtering options and screenshot quality for small-model friendliness ([48acc12](https://github.com/pm990320/ultimate-playwright-mcp/commit/48acc12f310e87eb2296419be4331d7008bc1679))
* stealth mode - remove automation fingerprints from Chrome ([cdc9421](https://github.com/pm990320/ultimate-playwright-mcp/commit/cdc94215bf678500ee0b9b57ba732944333a855c))


### Bug Fixes

* guard publish job with tag check instead of releases_created condition ([b5c7b51](https://github.com/pm990320/ultimate-playwright-mcp/commit/b5c7b511f73989c9048f662e8d910e2f1776496a))
* guard publish job with tag existence check ([1af1312](https://github.com/pm990320/ultimate-playwright-mcp/commit/1af1312962b6cf922bed5161e899b02f34089550))
* persist ref store to disk for cross-process ref resolution ([6fd64ac](https://github.com/pm990320/ultimate-playwright-mcp/commit/6fd64aca797bf5bf5ccec4df31c60ffcbe0e004c))


### Miscellaneous

* add release-please automation and commitlint ([#2](https://github.com/pm990320/ultimate-playwright-mcp/issues/2)) ([626e626](https://github.com/pm990320/ultimate-playwright-mcp/commit/626e62646975f9d75d6548dd122e6e81a90b1e03))
* integrate npm publish into release-please workflow ([47542cb](https://github.com/pm990320/ultimate-playwright-mcp/commit/47542cb9f9f110ba7f20d623e48b1fd867d2eaa9))
* integrate npm publish into release-please workflow ([52d2da3](https://github.com/pm990320/ultimate-playwright-mcp/commit/52d2da3e695e026f070cbad8ea0a7340134e5346))

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
