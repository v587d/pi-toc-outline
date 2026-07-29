/**
 * Markdown TOC Outline Extension for Pi TUI.
 *
 * Usage:
 *   /toc            open the outline modal
 *   /outline        alias of /toc
 *   alt+o           global shortcut to open the outline modal
 *
 * Modal layout (overlay, full terminal width, up to 100% height):
 *
 *   ┌─ esc: close   ← default   → full ─── top lines ─┐
 *   │ [user] Please help me...                         │
 *   │   Section heading         │ rendered Markdown    │
 *   │     Sub heading           │ of the peek region   │
 *   │ [user] Another question                          │
 *   │   Top level heading       │                      │
 *   └──────────────────────────────────────────────────┘
 *
 * Keys:
 *   Esc     close
 *   ↑ / ↓   move selection
 *   ←       switch to default height (≈ 12 list rows, 10/20 peek lines)
 *   →       switch to full height    (≈ 24 list rows, 20/40 peek lines)
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
import { highlightCode } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  type MarkdownTheme,
  SelectList,
  type SelectItem,
  matchesKey,
  visibleWidth,
  truncateToWidth,
} from "@earendil-works/pi-tui";

interface Heading {
  level: number;
  title: string;
  lines: string[];
  lineIdx: number;
}

interface UserTocItem {
  kind: "user";
  label: string;
  lines: string[];
}

interface HeadingTocItem {
  kind: "heading";
  level: number;
  title: string;
  lines: string[];
  lineIdx: number;
}

type TocItem = UserTocItem | HeadingTocItem;
type ViewMode = "default" | "full";

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

const DEFAULT_LIST_ROWS = 12;
const FULL_LIST_ROWS = 24;
const DEFAULT_HEADING_PEEK = 10;
const FULL_HEADING_PEEK = 20;
const DEFAULT_USER_PEEK = 20;
const FULL_USER_PEEK = 40;

const LABEL_PREVIEW_WIDTH = 40;

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

/** Build the visible label for a TOC item. */
function buildLabel(item: TocItem): string {
  if (item.kind === "user") {
    return item.label;
  }
  const indent = "  ".repeat(item.level - 1);
  return `${indent}${item.title}`;
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
        label: `[user]${preview}`,
        lines: text.split("\n"),
      });
    } else if (role === "assistant") {
      const headings = extractHeadings(text);
      if (headings.length > 0) {
        for (const h of headings) {
          items.push({
            kind: "heading",
            level: h.level,
            title: h.title,
            lines: h.lines,
            lineIdx: h.lineIdx,
          });
        }
      } else {
        // No headings: use first line as a synthetic heading
        const lines = text.split("\n");
        const firstLine = lines[0] || "";
        const title = truncateToWidth(firstLine, LABEL_PREVIEW_WIDTH, "…");
        items.push({
          kind: "heading",
          level: 1,
          title,
          lines,
          lineIdx: 0,
        });
      }
    }
  }
  return items;
}

async function openToc(ctx: any) {
  const tocItems = collectTocItems(ctx);
  if (tocItems.length === 0) {
    ctx.ui.notify("No headings or user messages found in this session.", "warning");
    return;
  }

  const themeRef = ctx.ui.theme;

  const items: SelectItem[] = tocItems.map((item, i) => ({
    value: String(i),
    label: buildLabel(item),
  }));

  const listDefault = new SelectList(
    items,
    Math.min(items.length, DEFAULT_LIST_ROWS),
    {
      selectedPrefix: (s) => themeRef.fg("accent", s),
      selectedText: (s) => themeRef.fg("accent", themeRef.bold(s)),
      description: (s) => themeRef.fg("muted", s),
      scrollInfo: (s) => themeRef.fg("dim", s),
      noMatch: (s) => themeRef.fg("warning", s),
    },
  );
  const listFull = new SelectList(
    items,
    Math.min(items.length, FULL_LIST_ROWS),
    {
      selectedPrefix: (s) => themeRef.fg("accent", s),
      selectedText: (s) => themeRef.fg("accent", themeRef.bold(s)),
      description: (s) => themeRef.fg("muted", s),
      scrollInfo: (s) => themeRef.fg("dim", s),
      noMatch: (s) => themeRef.fg("warning", s),
    },
  );
  listDefault.onSelect = () => {};
  listFull.onSelect = () => {};

  let currentIdx = 0;
  let mode: ViewMode = "default";

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const markdownTheme: MarkdownTheme = {
      heading: (t) => theme.fg("accent", theme.bold(t)),
      link: (t) => theme.fg("accent", t),
      linkUrl: (t) => theme.fg("dim", t),
      code: (t) => theme.fg("accent", t),
      codeBlock: (t) => theme.fg("muted", t),
      codeBlockBorder: (t) => theme.fg("dim", t),
      quote: (t) => theme.fg("dim", t),
      quoteBorder: (t) => theme.fg("dim", t),
      hr: (t) => theme.fg("dim", t),
      listBullet: (t) => theme.fg("muted", t),
      bold: (t) => theme.bold(t),
      italic: (t) => theme.italic(t),
      strikethrough: (t) => theme.strikethrough(t),
      underline: (t) => theme.underline(t),
      highlightCode: (code, lang) => highlightCode(code, lang ?? undefined, theme),
    };

    const markdown = new Markdown("", 0, 0, markdownTheme);

    const getPeekLines = () =>
      mode === "default"
        ? { heading: DEFAULT_HEADING_PEEK, user: DEFAULT_USER_PEEK }
        : { heading: FULL_HEADING_PEEK, user: FULL_USER_PEEK };

    const getActiveList = () => (mode === "default" ? listDefault : listFull);

    const updatePeek = () => {
      const item = tocItems[currentIdx];
      if (!item) {
        markdown.setText("");
        return;
      }
      const counts = getPeekLines();
      if (item.kind === "user") {
        markdown.setText(item.lines.slice(0, counts.user).join("\n"));
      } else {
        markdown.setText(
          item.lines
            .slice(item.lineIdx, item.lineIdx + counts.heading)
            .join("\n"),
        );
      }
    };

    const onSelectionChange = (item: SelectItem | null) => {
      currentIdx = item ? Number(item.value) : 0;
      updatePeek();
    };
    listDefault.onSelectionChange = onSelectionChange;
    listFull.onSelectionChange = onSelectionChange;
    updatePeek();

    const render = (width: number): string[] => {
      const top = theme.fg("muted", "─".repeat(width));

      const esc = theme.fg("dim", "esc: close");
      const defaultLabel =
        mode === "default"
          ? theme.fg("accent", "default")
          : theme.fg("dim", "default");
      const fullLabel =
        mode === "full"
          ? theme.fg("accent", "full")
          : theme.fg("dim", "full");
      const leftHeader = `${esc}   ${theme.fg("dim", "← ")}${defaultLabel}${theme.fg(
        "dim",
        "   → ",
      )}${fullLabel}`;
      const rightHeader = theme.fg("accent", "top lines");
      const gap = width - 2 - visibleWidth(leftHeader) - visibleWidth(rightHeader);
      const header =
        gap >= 2
          ? ` ${leftHeader}${" ".repeat(gap)}${rightHeader} `
          : ` ${leftHeader} `;

      const innerW = width - 2;
      const leftW = Math.max(20, Math.floor(innerW * 0.4));
      const sep = theme.fg("dim", " │ ");
      const sepW = 3;
      const rightW = Math.max(10, innerW - leftW - sepW);

      const activeList = getActiveList();
      const leftLines = activeList.render(leftW);
      const rightLines = markdown.render(rightW);

      const rows = Math.max(leftLines.length, rightLines.length);
      const body: string[] = [];
      for (let i = 0; i < rows; i++) {
        const l = leftLines[i] ?? "";
        const lw = visibleWidth(l);
        const lpad = lw < leftW ? " ".repeat(leftW - lw) : "";
        const r = rightLines[i] ?? "";
        body.push(` ${l}${lpad}${sep}${r} `);
      }

      const bottom = theme.fg("muted", "─".repeat(width));
      return [top, header, ...body, bottom];
    };

    return {
      render,
      invalidate() {
        listDefault.invalidate();
        listFull.invalidate();
        markdown.invalidate();
      },
      handleInput(data: string) {
        if (matchesKey(data, "escape")) {
          done();
          return;
        }
        if (matchesKey(data, "up") || matchesKey(data, "down")) {
          getActiveList().handleInput(data);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, "left")) {
          if (mode !== "default") {
            mode = "default";
            listDefault.setSelectedIndex(currentIdx);
            updatePeek();
            tui.requestRender();
          }
          return;
        }
        if (matchesKey(data, "right")) {
          if (mode !== "full") {
            mode = "full";
            listFull.setSelectedIndex(currentIdx);
            updatePeek();
            tui.requestRender();
          }
          return;
        }
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "100%",
      maxHeight: "100%",
    },
  });
}

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
