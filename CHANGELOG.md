# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-07

### Added

- **Fullscreen jump anchors (pi ≥ 0.84)** — register a display-only markdown
  transformer (`pi.registerMarkdownTransformer`) that injects an OSC 133 prompt
  marker before every assistant heading. The fullscreen TUI's built-in
  "jump to previous/next marked message" shortcuts
  (`tui.altScreen.previousPrompt`/`nextPrompt`, default `Ctrl+Shift+↑/↓`) then
  navigate the transcript heading-by-heading.
- **Fullscreen sidebar mode** — in fullscreen mode `/toc` opens as a left
  sidebar (45% width) with the transcript visible on the right, keeping native
  wheel/page scrolling and `Ctrl+Shift+↑/↓` jumps live while the outline is open.
- **Exact jump on Enter** — in the fullscreen sidebar, selecting an entry and
  pressing `Enter` scrolls the transcript to that exact heading/message and
  closes the sidebar (`computeJumpAnchors` + `jumpToMarkerIndex`).
- **Unit tests** — 16 test cases covering marker injection, the render
  pipeline, jump-anchor arithmetic, and graceful degradation.

### Changed

- `overlayOptions` is now evaluated per mode (`tui.mode`) instead of being fixed.
- Mouse reporting is only touched in regular mode — fullscreen mode leaves it
  alone so the transcript viewport keeps wheel scrolling and text selection.
- In fullscreen mode wheel / PgUp / PgDn are left to the native viewport
  (transcript scroll) instead of the preview panel.

### Compatibility notes

- Jumping (native keys and Enter) requires pi ≥ 0.84 with
  `--tui-mode fullscreen` (or `/settings` → TUI mode → fullscreen).
- The Enter jump relies on pi's internal fullscreen viewport layout
  (`currentLayout` / `primaryScrollView` / `scrollContentLines`). If pi changes
  those internals, the jump degrades gracefully to a notification pointing at
  the native `Ctrl+Shift+↑/↓` shortcuts — it never crashes or jumps wrongly.
- Regular mode behavior is unchanged: `/toc` keeps the two-panel
  TOC + preview dialog; the injected markers are inert there.

## [1.1.0] - 2026-07-31

### Changed

- Major UX overhaul: fixed-height framed overlay, hierarchical left panel
  (user messages + assistant headings), live Markdown preview with wheel and
  PgUp/PgDn scrolling, `Ctrl+X` copy, and selection index in the header.

## [1.0.0] - 2026-07-27

### Added

- Initial release: `/toc`, `/outline`, and `Alt+O` open an interactive Markdown
  table-of-contents overlay. Zero timeline injection.
