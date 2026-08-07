# pi-toc-outline

Pi extension for interactive Markdown table-of-contents outline in the Pi TUI.

![demo](./assets/demo.png)

## Why

Long Pi sessions accumulate many user messages and assistant responses with deeply nested Markdown headings. Scrolling through hundreds of lines to find a specific section is slow and distracting. This extension gives you a persistent, navigable outline — jump to any section instantly without touching the session timeline or the LLM context.

## Features

- **Zero timeline injection** — pure overlay + display-only markdown transform; nothing is written to the session or sent to the LLM.
- Open with `/toc`, `/outline`, or `Alt+O`.
- **Fullscreen mode (pi ≥ 0.84): heading-level jumps via `Enter`.** The extension registers a display-only markdown transformer that adds OSC 133 jump anchors before every assistant heading. `Ctrl+Shift+↑/↓` (pi's built-in) stay at message boundaries; opening `/toc` and pressing **`Enter`** on an entry jumps the transcript to that exact heading.
- Fixed-height overlay with a yellow framed border that never resizes as you navigate.
- Left panel: hierarchical outline.
  - User messages at level 1, orange-bold, flush left.
  - Assistant headings indented by depth: no-`#` text at level 2, 1-`#` at level 3, 2-`#` at level 4, etc.
- Right panel: live Markdown preview of the selected region, scrollable via mouse wheel and PgUp/PgDn.
- `Ctrl+X` copies the full selected Markdown to the system clipboard.
- Header shows current selection index (`3/15 entries`) and keyboard hints.

## Install

```bash
pi install git:github.com/v587d/pi-toc-outline@v1.2.1
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
(`\x1b]133;A`) before every Markdown heading in assistant messages.

**Two jump levels are available:**

| Key | Action | Level |
|---|---|---|
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Previous / next **marked message** | Message boundaries (user messages and assistant messages without tool calls) |
| `/toc` → `↑`/`↓` → `Enter` | Jump to the selected entry's exact line | Heading-level (any heading in any assistant message) |

**Why two levels?** pi's built-in shortcuts (`tui.altScreen.previousPrompt` /
`nextPrompt`, configurable in `~/.pi/agent/keybindings.json`) only recognize
markers at the true start of a rendered line. pi pads every Markdown line by
`outputPad` (default 1) columns, which pushes text-layer markers (ours) off the
line start — so the native keys stop at message boundaries, whose markers pi
adds at the component layer, before any padding. Our `Enter` jump instead scans
rendered lines with a whitespace-tolerant regex, so it can reach heading anchors.

In fullscreen mode `/toc` opens as a **wider, centered dialog** (75% width) with
the classic TOC + preview panels; the transcript stays visible on the sides so
native wheel/page scrolling and `Ctrl+Shift+↑/↓` keep working live while the
dialog is open. **`Enter` on a selected entry jumps the transcript to that exact
heading/message and closes the dialog.**

This uses the official display-only hook `pi.registerMarkdownTransformer()` (added
in pi 0.84). The markers are stripped from the screen before writing and never
enter the session or LLM context.

## Requirements

| Feature | Requirement |
|---|---|
| `/toc` outline overlay (both modes) | pi ≥ 0.80 (any version with extension commands) |
| Jump anchors (display-only) + `Ctrl+Shift+↑/↓` (message-level, pi's own) | pi ≥ 0.84 **and** fullscreen TUI mode |
| Wider centered dialog + `Enter` exact jump (heading-level) | pi ≥ 0.84 **and** fullscreen TUI mode |

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
   the dialog shows a notification pointing you to the native
   `Ctrl+Shift+↑/↓` shortcuts. It never crashes and never scrolls to the wrong
   place on its own.
2. **Jump-anchor ordering mirrors pi 0.84's marker rules** (user messages and
   tool-call-free assistant messages get a start-of-message anchor; our
   transformer adds one per heading). If pi changes those rules, `Enter` jumps
   could land one anchor off. The native `Ctrl+Shift+↑/↓` jump always stays
   correct, because it is pi's own mechanism (though it only reaches message
   boundaries, not headings — see the Jumping section).
3. **Anchors are skipped while a message is still streaming** (the transformer
   intentionally ignores streaming updates). Jump from the dialog once the
   message has finished to get exact positions.
4. **Other extensions' markdown transformers** chain in load order. Ours only
   inserts invisible marker lines before headings, so interaction is limited to
   ordering, not content mutation.
5. **On pi < 0.84** the transformer hook is not registered (guarded) and the
   Enter jump features are unavailable; the classic `/toc` dialog still works.

**Fallback summary:** any jump-related failure ends in a notification that
suggests `Ctrl+Shift+↑/↓` (pi's built-in, always available in fullscreen mode —
message-level only). The overlay itself is always safe to use for browsing,
previewing, and copying.

## Usage

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection (left panel) |
| `Wheel` / `PgUp` / `PgDn` | Scroll Markdown preview (right panel) |
| `Ctrl+X` | Copy selected Markdown to clipboard |
| `Esc` | Close |
| `Enter` | Jump to the selected entry in the transcript and close (fullscreen dialog only) |

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
