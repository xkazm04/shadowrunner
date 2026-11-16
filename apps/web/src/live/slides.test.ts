import { describe, expect, it } from "vitest";
import { buildDeck, HOLD_MS, parseScript, SlideDeck, type DeckCommand } from "./slides";

const SCRIPT = `# Talk title

Ignored intro.

## 1
Welcome to the cellar.

This line
wraps.

## 2

## 3
Last words.
`;

const blob = (name: string) => new Blob([name]);
const kinds = (commands: DeckCommand[]) => commands.map((c) => (c.kind === "say" ? `say:${c.id}` : c.kind === "slide" ? `slide:${c.index}` : c.kind));

describe("parseScript", () => {
  it("reads `## n` sections, one line per paragraph, joining wrapped lines", () => {
    const sections = parseScript(SCRIPT);
    expect(sections.get(1)).toEqual(["Welcome to the cellar.", "This line wraps."]);
    expect(sections.get(2)).toEqual([]);
    expect(sections.get(3)).toEqual(["Last words."]);
    expect(sections.has(0)).toBe(false);
  });

  it("reads CRLF scripts too", () => {
    expect(parseScript("## 1\r\nOne.\r\n\r\nTwo.\r\n").get(1)).toEqual(["One.", "Two."]);
  });
});

describe("buildDeck", () => {
  it("keeps images only, in natural name order, each with its section", () => {
    const files = ["slide-10.png", "notes.txt", "slide-2.JPG", "slide-1.webp", "script.md"].map((name) => ({ name, file: blob(name) }));
    const deck = buildDeck(files, SCRIPT);
    expect(deck.map((s) => s.name)).toEqual(["slide-1.webp", "slide-2.JPG", "slide-10.png"]);
    expect(deck.map((s) => s.lines.length)).toEqual([2, 0, 1]);
    expect(buildDeck(files, undefined).every((s) => s.lines.length === 0)).toBe(true);
  });
});

describe("SlideDeck", () => {
  const deck = () => new SlideDeck(buildDeck(["a.png", "b.png", "c.png"].map((name) => ({ name, file: blob(name) })), SCRIPT));

  it("starts with slide 0's image then its lines, and moves on at the last line-end", () => {
    const d = deck();
    expect(kinds(d.start())).toEqual(["slide:0", "say:slide-0-0", "say:slide-0-1"]);
    expect(d.lineEnd("slide-0-0")).toEqual([]);
    expect(d.lineEnd("other")).toEqual([]);
    const next = d.lineEnd("slide-0-1");
    expect(kinds(next)).toEqual(["slide:1", "hold"]);
    expect(next.at(-1)).toMatchObject({ kind: "hold", ms: HOLD_MS });
  });

  it("moves on after a line-less slide's hold, and finishes after the last", () => {
    const d = deck();
    d.start();
    const hold = d.lineEnd("slide-0-1").at(-1);
    if (hold?.kind !== "hold") throw new Error("expected a hold");
    expect(d.held(hold.token - 1)).toEqual([]);
    expect(kinds(d.held(hold.token))).toEqual(["slide:2", "say:slide-2-0"]);
    expect(kinds(d.lineEnd("slide-2-0"))).toEqual(["done"]);
    expect(d.view.phase).toBe("done");
  });

  it("stops what is queued on Prev and Next", () => {
    const d = deck();
    expect(kinds(d.next())).toEqual(["slide:0", "say:slide-0-0", "say:slide-0-1"]);
    expect(kinds(d.next())).toEqual(["stop", "slide:1", "hold"]);
    expect(kinds(d.prev())).toEqual(["stop", "slide:0", "say:slide-0-0", "say:slide-0-1"]);
    expect(kinds(d.prev())).toEqual(["stop", "slide:0", "say:slide-0-0", "say:slide-0-1"]);
  });

  it("pause holds a finished slide until resume", () => {
    const d = deck();
    d.start();
    d.pause();
    expect(d.lineEnd("slide-0-1")).toEqual([]);
    expect(d.view).toMatchObject({ index: 0, phase: "finished-slide", paused: true });
    expect(kinds(d.resume())).toEqual(["slide:1", "hold"]);
  });

  it("ends where it is: later line-ends and holds do nothing", () => {
    const d = deck();
    d.start();
    d.end();
    expect(d.lineEnd("slide-0-1")).toEqual([]);
    expect(d.view.phase).toBe("done");
  });
});
