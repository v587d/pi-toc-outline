/**
 * Unit tests for pi-toc-outline v2 jump-marker machinery.
 *
 * Verifies:
 *  1. injectHeadingJumpMarkers() — pure text transform (fences, nested, etc.)
 *  2. Marker survives the real pi-tui Markdown render pipeline at line start
 *  3. Rendered marker line is matched by the exact regex the fullscreen TUI
 *     (TuiAltScreen.scrollToPrompt) uses to find jump anchors
 *
 * Run: bun test extensions/toc.test.ts
 */
import { describe, expect, test } from "bun:test";
import { Markdown } from "@earendil-works/pi-tui";
import {
  JUMP_MARKER,
  computeJumpAnchors,
  injectHeadingJumpMarkers,
  jumpToMarkerIndex,
} from "../extensions/toc.ts";

/** Exact regex from pi-tui dist/tui-alt-screen.js (scrollToPrompt). */
const OSC133_PROMPT_START = /^\x1b\]133;A(?:\x07|\x1b\\)/;

const theme: Record<string, (t: string) => string> = {
  heading: (t) => t,
  bold: (t) => t,
  italic: (t) => t,
  link: (t) => t,
  linkUrl: (t) => t,
  code: (t) => t,
  codeBlock: (t) => t,
  codeBlockBorder: (t) => t,
  quote: (t) => t,
  quoteBorder: (t) => t,
  hr: (t) => t,
  listBullet: (t) => t,
  strikethrough: (t) => t,
  underline: (t) => t,
};

describe("injectHeadingJumpMarkers", () => {
  test("injects a marker line before every top-level heading", () => {
    const md = "# One\n\n## Two\n\n### Three\n";
    expect(injectHeadingJumpMarkers(md)).toBe(
      `${JUMP_MARKER}\n# One\n\n${JUMP_MARKER}\n## Two\n\n${JUMP_MARKER}\n### Three\n`,
    );
  });

  test("skips headings inside fenced code blocks", () => {
    const md = "# Real\n\n```ts\n# Not a heading\nconst x = 1;\n```\n\n# Real Two\n";
    const out = injectHeadingJumpMarkers(md);
    // two markers only
    expect(out.split(JUMP_MARKER).length - 1).toBe(2);
    expect(out).toContain(`${JUMP_MARKER}\n# Real`);
    expect(out).toContain(`${JUMP_MARKER}\n# Real Two`);
  });

  test("does not mark non-heading lines", () => {
    const md = "plain text\n- list item\n> quote # not heading\n`# inline code`\n";
    expect(injectHeadingJumpMarkers(md)).toBe(md);
  });

  test("heading-like line inside list item is not marked (consistent with TOC)", () => {
    const md = "- # nested\n";
    expect(injectHeadingJumpMarkers(md)).toBe(md);
  });

  test("empty / no-heading markdown passes through unchanged", () => {
    expect(injectHeadingJumpMarkers("")).toBe("");
    expect(injectHeadingJumpMarkers("just text")).toBe("just text");
  });

  test("marker survives real pi-tui Markdown rendering at line start", () => {
    const md = new Markdown("", 0, 0, theme as any, undefined, {
      transform: (text) => injectHeadingJumpMarkers(text),
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true,
    });
    md.setText("# Section One\nsome text\n\n## Sub Two\nmore\n");
    const lines = md.render(80);

    const matches = lines.filter((l) => OSC133_PROMPT_START.test(l));
    expect(matches.length).toBe(2); // one per heading
    // marker lines render as zero-visible-width lines (invisible on screen)
    for (const m of matches) {
      const stripped = m.replace(OSC133_PROMPT_START, "");
      expect(stripped.trim().length).toBe(0);
    }
  });

  test("rendered heading still parses as a heading after injection", () => {
    const md = new Markdown("", 0, 0, theme as any, undefined, {
      transform: (text) => injectHeadingJumpMarkers(text),
    });
    md.setText("# Section One\n");
    const lines = md.render(80);
    // Marker line + heading line + padding; the heading text is still its own line
    expect(lines.some((l) => l.trim() === "Section One")).toBe(true);
  });
});

describe("computeJumpAnchors", () => {
  const msg = (role: string, text: string, content?: any[]) => ({
    type: "message",
    message: { role, content: content ?? [{ type: "text", text }] },
  });

  test("user message = one anchor", () => {
    const anchors = computeJumpAnchors([msg("user", "hello")]);
    expect(anchors).toEqual([0]);
  });

  test("user then assistant-with-headings keeps global order", () => {
    const entries = [
      msg("user", "q1"),
      msg("assistant", "# H1\n\n## H2\n"),
    ];
    // markers: [user0, asst-start1, H1=2, H2=3]
    expect(computeJumpAnchors(entries)).toEqual([0, 2, 3]);
  });

  test("tool-call assistant message has no start-of-message anchor", () => {
    const entries = [
      msg("user", "q1"),
      msg("assistant", "# H1\n", [
        { type: "toolCall", id: "t1" },
        { type: "text", text: "# H1\n" },
      ]),
      msg("user", "q2"),
    ];
    // markers: [user0, H1=1, user2=2]
    expect(computeJumpAnchors(entries)).toEqual([0, 1, 2]);
  });

  test("tool-call assistant without any text contributes no item (skipped, like TOC)", () => {
    const entries = [msg("assistant", "done", [{ type: "toolCall", id: "t1" }])];
    expect(computeJumpAnchors(entries)).toEqual([]);
  });

  test("non-message entries are skipped on both sides", () => {
    const entries = [
      { type: "compaction", id: "c1" },
      msg("user", "q"),
      { type: "custom", id: "x" },
    ];
    expect(computeJumpAnchors(entries)).toEqual([0]);
  });

  test("assistant without headings but no tool calls has a start anchor", () => {
    const anchors = computeJumpAnchors([msg("assistant", "just prose")]);
    expect(anchors).toEqual([0]);
  });
});

describe("jumpToMarkerIndex", () => {
  const marker = JUMP_MARKER;

  const makeTui = (lines: string[]) => {
    const scrollView: any = { scrollTo: (row: number) => (scrollView.called = row) };
    const root = {
      children: [
        { children: [] },
        { scrollView, scrollContentLines: lines, children: [] },
      ],
    };
    return {
      tui: { currentLayout: { root, primaryScrollView: scrollView } } as any,
      scrollView,
    };
  };

  test("scrolls to the k-th marker row exactly", () => {
    const lines = [
      "header line",
      `${marker}user msg`,     // anchor 0 at row 1
      `${marker}# heading A`,  // anchor 1 at row 2
      "text",
      `${marker}## heading B`, // anchor 2 at row 4
      "more",
    ];
    const { tui, scrollView } = makeTui(lines);
    expect(jumpToMarkerIndex(tui, 2)).toBe(true);
    expect(scrollView.called).toBe(4);
    expect(jumpToMarkerIndex(tui, 0)).toBe(true);
    expect(scrollView.called).toBe(1);
  });

  test("returns false when the anchor index is out of range", () => {
    const { tui } = makeTui([`${marker}only one`]);
    expect(jumpToMarkerIndex(tui, 5)).toBe(false);
  });

  test("returns false when pi internals are missing (regular mode / older pi)", () => {
    expect(jumpToMarkerIndex({}, 0)).toBe(false);
    expect(jumpToMarkerIndex({ currentLayout: {} }, 0)).toBe(false);
    expect(
      jumpToMarkerIndex({ currentLayout: { root: {}, primaryScrollView: {} } }, 0),
    ).toBe(false);
  });
});
