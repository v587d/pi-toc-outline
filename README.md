# pi-toc-outline

Pi extension for interactive Markdown table-of-contents outline in the Pi TUI.

![demo](./assets/demo.png)

## Why

Long Pi sessions accumulate many user messages and assistant responses with deeply nested Markdown headings. Scrolling through hundreds of lines to find a specific section is slow and distracting. This extension gives you a persistent, navigable outline — jump to any section instantly without touching the session timeline or the LLM context.

## Features

- **Zero timeline injection** — pure overlay + display-only markdown transform; nothing is written to the session or sent to the LLM.
- Open with `/toc`, `/outline`, or `Alt+O`.
- **Fullscreen mode (pi ≥ 0.84): native heading-level jumps.** The extension registers a display-only markdown transformer that adds OSC 133 jump anchors before every assistant heading, so the built-in `Ctrl+Shift+↑/↓` shortcuts (`tui.altScreen.previousPrompt/nextPrompt`) navigate the transcript heading-by-heading — no overlay needed.
- Fixed-height overlay with a yellow framed border that never resizes as you navigate.
- Left panel: hierarchical outline.
  - User messages at level 1, orange-bold, flush left.
  - Assistant headings indented by depth: no-`#` text at level 2, 1-`#` at level 3, 2-`#` at level 4, etc.
- Right panel: live Markdown preview of the selected region, scrollable via mouse wheel and PgUp/PgDn.
- `Ctrl+X` copies the full selected Markdown to the system clipboard.
- Header shows current selection index (`3/15 entries`) and keyboard hints.

## Install

```bash
pi install git:github.com/v587d/pi-toc-outline@v1.2.0
```

## Command

| Command | Description |
|---|---|
| `/toc` | Open the table-of-contents outline overlay |
| `/outline` | Alias for `/toc` |
| `Alt+O`  | Global shortcut to open the outline from anywhere |

## Jumping (fullscreen mode, pi ≥ 0.84)

With `--tui-mode fullscreen` (or `/settings` → TUI mode → fullscreen), the extension
registers a display-only markdown transformer that injects an OSC 133 prompt marker
(`\x1b]133;A`) before every Markdown heading in assistant messages. Pi's built-in
"jump to previous/next marked message" shortcuts then navigate the transcript
heading-by-heading:

| Key | Action |
|---|---|
| `Ctrl+Shift+↑` | Jump to the previous heading (or message) |
| `Ctrl+Shift+↓` | Jump to the next heading (or message) |

These bindings are configurable in `~/.pi/agent/keybindings.json`
(`tui.altScreen.previousPrompt` / `tui.altScreen.nextPrompt`). User messages keep
their built-in message-boundary anchor, so jumps cover the whole conversation.

In fullscreen mode `/toc` opens as a **left sidebar** (45% width): the outline stays
visible while the transcript on the right keeps native wheel/page scrolling and
`Ctrl+Shift+↑/↓` jumps. **`Enter` on a selected entry jumps the transcript to that
exact heading/message and closes the sidebar.**

This uses the official display-only hook `pi.registerMarkdownTransformer()` (added
in pi 0.84). The markers are stripped from the screen before writing and never
enter the session or LLM context.

## Requirements

| Feature | Requirement |
|---|---|
| `/toc` outline overlay (both modes) | pi ≥ 0.80 (any version with extension commands) |
| Fullscreen jump anchors + `Ctrl+Shift+↑/↓` | pi ≥ 0.84 **and** fullscreen TUI mode |
| Sidebar mode + `Enter` exact jump | pi ≥ 0.84 **and** fullscreen TUI mode |

Enable fullscreen mode with `--tui-mode fullscreen` at startup, or switch at
runtime via `/settings` → TUI mode → fullscreen. In regular mode the extension
keeps its classic two-panel dialog; jump anchors are injected but inert.

## Risks & Fallback

Everything here is display-only — nothing is written to the session, nothing is
sent to the LLM — but please understand the following limits before relying on
the jump features:

1. **The `Enter` exact jump relies on pi's internal fullscreen viewport layout**
   (`currentLayout` / `primaryScrollView` / `scrollContentLines`). These are not
   public API. If a future pi version changes them, `Enter` degrades gracefully:
   the sidebar shows a notification pointing you to the native
   `Ctrl+Shift+↑/↓` shortcuts. It never crashes and never scrolls to the wrong
   place on its own.
2. **Jump-anchor ordering mirrors pi 0.84's marker rules** (user messages and
   tool-call-free assistant messages get a start-of-message anchor; our
   transformer adds one per heading). If pi changes those rules, `Enter` jumps
   could land one anchor off. The native `Ctrl+Shift+↑/↓` jump always stays
   correct, because it is pi's own mechanism.
3. **Anchors are skipped while a message is still streaming** (the transformer
   intentionally ignores streaming updates). Jump from the sidebar once the
   message has finished to get exact positions.
4. **Other extensions' markdown transformers** chain in load order. Ours only
   inserts invisible marker lines before headings, so interaction is limited to
   ordering, not content mutation.
5. **On pi < 0.84** the transformer hook is not registered (guarded) and the
   sidebar/Enter features are unavailable; the classic `/toc` dialog still works.

**Fallback summary:** any jump-related failure ends in a notification that
suggests `Ctrl+Shift+↑/↓` (pi's built-in, always available in fullscreen mode).
The overlay itself is always safe to use for browsing, previewing, and copying.

## Usage

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection (left panel) |
| `Wheel` / `PgUp` / `PgDn` | Scroll Markdown preview (right panel) |
| `Ctrl+X` | Copy selected Markdown to clipboard |
| `Esc` | Close |
| `Enter` | Jump to the selected entry in the transcript and close (fullscreen sidebar only) |

## Security

This extension runs entirely within Pi's TUI process.

The fullscreen jump markers are display-only: pi strips them before writing the
screen, and they are never stored in the session or sent to a model.

It does **not**:

- make any network requests,
- read or write files outside the Pi session,
- execute shell commands,
- or access the system clipboard except when you explicitly press `Ctrl+X` to copy.

All outline data is derived from the current session's message entries, which are already in memory.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT
