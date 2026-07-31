/**
 * Markdown TOC Outline Extension for Pi TUI.
 *
 * Usage:
 *   /toc            open the outline modal
 *   /outline        alias of /toc
 *   alt+o           global shortcut to open the outline modal
 *
 * Modal layout (overlay, fixed height, full terminal width):
 *
 *   ┌─ ↑↓ select · wheel/PgUp/PgDn scroll · ctrl+x copy · esc close ─ 3/15 entries ─┐
 *   │ [user] Please help me...                         │
 *   │   Section heading         │ rendered Markdown    │
 *   │     Sub heading           │ of the peek region   │
 *   │ [user] Another question                          │
 *   │   Top level heading       │                      │
 *   └──────────────────────────────────────────────────┘
 *
 * Keys:
 *   Esc            close
 *   ↑ / ↓          move selection (left panel)
 *   PgUp/Dn        scroll preview (right panel)
 *   Wheel          scroll preview (right panel)
 *   ctrl+x         copy selected markdown to clipboard
 *
 * Left column:
 *   - User messages become a single un-indented entry: [user]<first 40 columns>
 *   - Assistant messages are split into Markdown headings, indented by level
 *
 * Right column:
 *   - User entry: the first N lines of that user message, rendered as Markdown
 *   - Heading entry: the heading line plus following lines, rendered as Markdown
 *
 * Zero timeline injection: nothing is written to the session, nothing enters
 * LLM context. The modal is pure TUI state and disappears when closed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, highlightCode } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  type MarkdownTheme,
  SelectList,
  type SelectItem,
  matchesKey,
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// ── types ────────────────────────────────────────────────────────────────────

interface Heading {
  level: number;
  title: string;
  lines: string[];
  lineIdx: number;
}

interface UserTocItem {
  kind: "user";
  level: number; // always 1
  title: string; // preview text (no [user] prefix)
  lines: string[];
}

interface HeadingTocItem {
  kind: "heading";
  level: number; // base 2 + original # count: 0#→2, 1#→3, 2#→4, n#→n+2
  title: string; // heading text without # prefix
  lines: string[];
  lineIdx: number;
}

type TocItem = UserTocItem | HeadingTocItem;

// ── constants ────────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

const LABEL_PREVIEW_WIDTH = 80;

/** Fixed overlay chrome rows outside the body viewport: top-border + header + rule + bottom-border. */
const TOC_OVERLAY_CHROME_LINES = 4;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a pi-ai message (string or content-block array). */
function extractText(message: any): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (!c) return "";
        if (typeof c === "string") return c;
        if (typeof c.text === "string") return c.text;
        if (typeof c.content === "string") return c.content;
        return "";
      })
      .filter((s: string) => s.length > 0)
      .join("\n");
  }
  return "";
}

/** Extract headings from assistant text, skipping fenced code blocks. */
function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  const lines = text.split("\n");
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = line.match(HEADING_RE);
    if (m) {
      headings.push({
        level: m[1].length,
        title: m[2],
        lines,
        lineIdx: i,
      });
    }
  }
  return headings;
}

/** Build the visible label for a TOC item. No #-prefixes — hierarchy is conveyed by indentation alone. */
function buildLabel(item: TocItem, theme: any): string {
  const indent = "  ".repeat(item.level - 1);
  const text = item.title;
  if (item.kind === "user") {
    // User messages: orange bold, level 1 (no indent)
    return `${indent}${theme.fg("warning", theme.bold(text))}`;
  }
  // All assistant items: plain text with level-based indent
  return `${indent}${text}`;
}

/** Collect TOC items from the current session. */
function collectTocItems(ctx: any): TocItem[] {
  const items: TocItem[] = [];
  let entries: any[];
  try {
    entries = ctx.sessionManager.buildContextEntries();
  } catch {
    entries = ctx.sessionManager.getBranch();
  }

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    const text = extractText(entry.message);
    if (!text) continue;

    if (role === "user") {
      const stripped = text.replace(/\n/g, " ");
      const preview = truncateToWidth(stripped, LABEL_PREVIEW_WIDTH, "…");
      items.push({
        kind: "user",
        level: 1,
        title: preview,
        lines: text.split("\n"),
      });
    } else if (role === "assistant") {
      const headings = extractHeadings(text);
      if (headings.length > 0) {
        for (const h of headings) {
          // Level = base 2 + original heading count.  0# → 2, 1# → 3, 2# → 4, n# → n+2.
          const shiftedLevel = h.level + 2;
          items.push({
            kind: "heading",
            level: shiftedLevel,
            title: h.title,
            lines: h.lines,
            lineIdx: h.lineIdx,
          });
        }
      } else {
        // No headings: level 2 (base assistant indent)
        const lines = text.split("\n");
        const firstLine = lines[0] || "";
        const title = truncateToWidth(firstLine, LABEL_PREVIEW_WIDTH, "…");
        items.push({
          kind: "heading",
          level: 2,
          title,
          lines,
          lineIdx: 0,
        });
      }
    }
  }
  return items;
}

/** Compute a fixed dialog height based on terminal size (matches BTW's approach). */
function getDialogHeight(): number {
  const terminalRows = process.stdout.rows ?? 30;
  return Math.max(18, Math.min(36, Math.floor(terminalRows * 0.85)));
}

// ── overlay rendering helpers ────────────────────────────────────────────────

/** Build a framed border line like ┌──...──┐ using the "warning" (yellow) colour. */
function borderLine(
  innerWidth: number,
  edge: "top" | "bottom",
  theme: any,
): string {
  const left = edge === "top" ? "┌" : "└";
  const right = edge === "top" ? "┐" : "┘";
  return theme.fg("warning", `${left}${"─".repeat(innerWidth)}${right}`);
}

/** Build a framed rule line like ├──...──┤. */
function ruleLine(innerWidth: number, theme: any): string {
  return theme.fg("warning", `├${"─".repeat(innerWidth)}┤`);
}

/** Build a single framed content line like │ content         │. */
function frameLine(
  content: string,
  innerWidth: number,
  theme: any,
): string {
  const truncated = truncateToWidth(content, innerWidth, "");
  const padding = Math.max(0, innerWidth - visibleWidth(truncated));
  return `${theme.fg("warning", "│")}${truncated}${" ".repeat(padding)}${theme.fg("warning", "│")}`;
}

/** Strip potential cursor-marker sequences from a rendered line so they don't
 *  skew overlay width calculations. */
function sanitizeRenderedLine(line: string): string {
  return line.replace(/\x1b_\x1b\\/g, "");
}

/** Get the lines for the right preview panel, trimmed to a max peek count. */
function getPreviewLines(item: TocItem): string[] {
  const headingPeek = 30;
  const userPeek = 50;

  if (item.kind === "user") {
    return item.lines.slice(0, userPeek);
  }
  return item.lines.slice(item.lineIdx, item.lineIdx + headingPeek);
}

// ── main open function ───────────────────────────────────────────────────────

async function openToc(ctx: any) {
  const tocItems = collectTocItems(ctx);
  if (tocItems.length === 0) {
    ctx.ui.notify("No headings or user messages found in this session.", "warning");
    return;
  }

  const themeRef = ctx.ui.theme;

  // ── mutable state ────────────────────────────────────────────────────────
  let currentIdx = 0;
  let rightScrollOffset = 0; // how many lines the right preview is scrolled
  let followRight = false; // auto-scroll to bottom of preview on selection change; starts at top

  // ── build SelectLists ────────────────────────────────────────────────────
  const items: SelectItem[] = tocItems.map((item, i) => ({
    value: String(i),
    label: buildLabel(item, themeRef),
  }));

  const dialogHeight = getDialogHeight();
  const viewportHeight = dialogHeight - TOC_OVERLAY_CHROME_LINES;
  const listRows = Math.min(items.length, viewportHeight);

  const selectList = new SelectList(items, listRows, {
    selectedPrefix: (s) => themeRef.fg("accent", s),
    selectedText: (s) => themeRef.fg("accent", themeRef.bold(s)),
    description: (s) => themeRef.fg("muted", s),
    scrollInfo: (s) => themeRef.fg("dim", s),
    noMatch: (s) => themeRef.fg("warning", s),
  });
  selectList.onSelect = () => {};

  const markdownTheme: MarkdownTheme = {
    heading: (t) => themeRef.fg("accent", themeRef.bold(t)),
    link: (t) => themeRef.fg("accent", t),
    linkUrl: (t) => themeRef.fg("dim", t),
    code: (t) => themeRef.fg("accent", t),
    codeBlock: (t) => themeRef.fg("muted", t),
    codeBlockBorder: (t) => themeRef.fg("dim", t),
    quote: (t) => themeRef.fg("dim", t),
    quoteBorder: (t) => themeRef.fg("dim", t),
    hr: (t) => themeRef.fg("dim", t),
    listBullet: (t) => themeRef.fg("muted", t),
    bold: (t) => themeRef.bold(t),
    italic: (t) => themeRef.italic(t),
    strikethrough: (t) => themeRef.strikethrough(t),
    underline: (t) => themeRef.underline(t),
    highlightCode: (code, lang) => highlightCode(code, lang ?? undefined, themeRef),
  };

  const markdown = new Markdown("", 0, 0, markdownTheme);

  // ── peek logic ───────────────────────────────────────────────────────────
  const updatePeek = () => {
    const item = tocItems[currentIdx];
    if (!item) {
      markdown.setText("");
      rightScrollOffset = 0;
      return;
    }
    const rawLines = getPreviewLines(item);
    markdown.setText(rawLines.join("\n"));
    // Reset to top on selection change (don't jump to bottom)
    followRight = false;
    rightScrollOffset = 0;
  };

  const onSelectionChange = (item: SelectItem | null) => {
    currentIdx = item ? Number(item.value) : 0;
    updatePeek();
  };
  selectList.onSelectionChange = onSelectionChange;
  updatePeek();

  // ── mouse scroll ─────────────────────────────────────────────────────────
  function getMouseScrollDelta(data: string): number | null {
    const match = data.match(/^\x1b\[<(\d+);\d+;\d+[Mm]$/);
    if (!match) return null;
    const button = Number(match[1]);
    if ((button & 64) !== 64) return null;
    return (button & 1) === 0 ? -3 : 3;
  }

  // ── open overlay ─────────────────────────────────────────────────────────
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      // Enable SGR mouse reporting so wheel / touchpad events reach handleInput.
      tui.terminal?.write?.("\x1b[?1000h\x1b[?1006h");

      const render = (width: number): string[] => {
        const dialogWidth = Math.max(24, width);
        const innerWidth = Math.max(22, dialogWidth - 2);

        // Split body into left / right
        const leftW = Math.max(24, Math.floor(innerWidth * 0.5));
        const sepStr = theme.fg("warning", " │ ");
        const sepW = 3;
        const rightW = Math.max(10, innerWidth - leftW - sepW);

        // Left panel: SelectList renders exactly listHeight lines
        const rawLeft = selectList.render(leftW);
        const leftLines = rawLeft.map(sanitizeRenderedLine);

        // Right panel: render markdown then wrap to rightW
        const rightRaw = markdown.render(rightW);
        const rightLines: string[] = [];
        for (const line of rightRaw) {
          if (!line) {
            rightLines.push("");
            continue;
          }
          rightLines.push(...wrapTextWithAnsi(sanitizeRenderedLine(line), Math.max(1, rightW)));
        }

        // Clamp right scroll
        const maxRightScroll = Math.max(0, rightLines.length - viewportHeight);
        if (followRight) {
          rightScrollOffset = maxRightScroll;
        } else {
          rightScrollOffset = Math.max(0, Math.min(rightScrollOffset, maxRightScroll));
          if (rightScrollOffset >= maxRightScroll) {
            followRight = true;
          }
        }

        const visibleRight = rightLines.slice(
          rightScrollOffset,
          rightScrollOffset + viewportHeight,
        );

        // Both panels fill exactly viewportHeight rows
        const bodyLines: string[] = [];
        for (let i = 0; i < viewportHeight; i++) {
          const l = leftLines[i] ?? "";
          const r = visibleRight[i] ?? "";
          const lw = visibleWidth(l);
          const lpad = lw < leftW ? " ".repeat(leftW - lw) : "";
          bodyLines.push(`${l}${lpad}${sepStr}${r}`);
        }

        // Scroll info for right panel overflow
        const hiddenRightAbove = rightScrollOffset;
        const hiddenRightBelow = Math.max(0, maxRightScroll - rightScrollOffset);
        const scrollInfo =
          hiddenRightAbove || hiddenRightBelow
            ? `  preview ↑${hiddenRightAbove} ↓${hiddenRightBelow}`
            : "";

        // Header (hints + entry count)
        const leftHeader = theme.fg("dim", `↑↓ select · wheel/PgUp/PgDn scroll · ctrl+x copy · esc close${scrollInfo}`);
        const rightHeader = theme.fg("accent", `${currentIdx + 1}/${tocItems.length} entries`);
        const gap = innerWidth - visibleWidth(leftHeader) - visibleWidth(rightHeader);
        const headerStr =
          gap >= 2
            ? `${leftHeader}${" ".repeat(gap)}${rightHeader}`
            : leftHeader;

        // Assemble full dialog (fixed height)
        const lines: string[] = [];
        lines.push(borderLine(innerWidth, "top", theme));
        lines.push(frameLine(headerStr, innerWidth, theme));
        lines.push(ruleLine(innerWidth, theme));
        for (const bl of bodyLines) {
          lines.push(frameLine(bl, innerWidth, theme));
        }
        lines.push(borderLine(innerWidth, "bottom", theme));

        return lines;
      };

      return {
        render,
        invalidate() {
          selectList.invalidate();
          markdown.invalidate();
        },
        handleInput(data: string) {
          // Mouse scroll
          const mouseDelta = getMouseScrollDelta(data);
          if (mouseDelta !== null) {
            followRight = false;
            rightScrollOffset = Math.max(
              0,
              rightScrollOffset + mouseDelta,
            );
            tui.requestRender();
            return;
          }

          if (matchesKey(data, "escape")) {
            done();
            return;
          }

          if (matchesKey(data, "page_up") || matchesKey(data, "page_down")) {
            followRight = false;
            const step = viewportHeight - 2;
            const delta = matchesKey(data, "page_up") ? -step : step;
            rightScrollOffset = Math.max(0, rightScrollOffset + delta);
            tui.requestRender();
            return;
          }

          if (matchesKey(data, "up") || matchesKey(data, "down")) {
            selectList.handleInput(data);
            tui.requestRender();
            return;
          }

          if (matchesKey(data, Key.ctrl("x"))) {
            const item = tocItems[currentIdx];
            if (item) {
              // Copy full original markdown, not just the peek slice
              const text =
                item.kind === "user"
                  ? item.lines.join("\n")
                  : item.lines.slice(item.lineIdx).join("\n");
              copyToClipboard(text).catch(() => {});
            }
            return;
          }
        },
        dispose() {
          tui.terminal?.write?.("\x1b[?1000l\x1b[?1006l");
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "100%",
        maxHeight: "100%",
      },
    },
  );
}

// ── extension entry ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("toc", {
    description: "Open Markdown table-of-contents outline",
    handler: async (_args, ctx) => openToc(ctx),
  });

  pi.registerCommand("outline", {
    description: "Open Markdown table-of-contents outline",
    handler: async (_args, ctx) => openToc(ctx),
  });

  pi.registerShortcut("alt+o", {
    description: "Open Markdown table-of-contents outline",
    handler: async (ctx) => openToc(ctx),
  });
}
