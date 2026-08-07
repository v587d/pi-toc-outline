# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-08-07

### Fixed

- **Heading-level jumps now actually work.** pi's Markdown renderer pads every
  line by `outputPad` (default 1) columns, which pushed injected markers off the
  true line start — pi's strict `scrollToPrompt` regex (and our first jump
  implementation) could not see them, so only user-message boundaries jumped.
  `jumpToMarkerIndex` now scans with a whitespace-tolerant regex, and the
  `Enter` exact jump reaches headings (including inside tool-call messages).
- **Fullscreen `/toc` layout** is now a wider centered dialog (75%) with the
  classic TOC + preview panels, instead of a left-anchored 45% sidebar.

### Changed

- Native `Ctrl+Shift+↑/↓` are documented as message-level only (pi's built-in
  markers sit at the component layer, before padding); heading-level jumps are
  the extension's `Enter` feature.

## [1.2.0] - 2026-08-07

### Added

- **Fullscreen jump anchors (pi ≥ 0.84)** — register a display-only markdown
  transformer (`pi.registerMarkdownTransformer`) that injects an OSC 133 prompt
  marker before every assistant heading.
- **Wider centered dialog in fullscreen mode** — `/toc` stays a two-panel
  TOC + preview dialog, centered at 75% width, with the transcript visible on
  the sides for live native scrolling and message-level jumps.
- **Exact jump on Enter** — selecting an entry and pressing `Enter` scrolls the
  transcript to that exact heading/message and closes the dialog
  (`computeJumpAnchors` + `jumpToMarkerIndex`).
- **Unit tests** — 17 test cases covering marker injection, the render
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
- Native `Ctrl+Shift+↑/↓` reach message boundaries only (pi pads Markdown
  lines, so text-layer heading markers are not at the line start); heading-level
  jumps are provided by `Enter` in the `/toc` dialog.
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
