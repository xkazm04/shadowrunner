// Slides (spec flashhead-live, task 3.3): a folder of images, sorted by name, plus `script.md`
// whose `## 1`, `## 2`... sections hold what Iris says on each slide, one line per paragraph. The
// deck is a pure state machine: every action returns the commands to send, so the advance rules
// (a slide moves on when its last line's `line-end` arrives) are unit-tested without a socket.
//
// Decisions the spec leaves open:
// - `## n` is the n-th image (1-based in the script, 0-based on the wire); the say ids are
//   `slide-<index>-<line>`, both 0-based.
// - A paragraph's lines are joined with a space; text before the first `## n` is ignored.
// - A slide with no lines holds for HOLD_MS, then moves on (a deck never stalls on air).
// - Prev and Next stop what is queued first (`stop`), then show the slide and speak it.
// - Pause lets the current line finish and holds the slide; Resume moves on if it was done.

export const HOLD_MS = 4000;
export const SCRIPT_NAME = "script.md";
const IMAGE = /\.(png|jpe?g|webp)$/i;
const SECTION = /^##\s+(\d+)\s*$/;

export interface Slide {
  name: string;
  file: Blob;
  lines: string[];
}

export function isImageName(name: string): boolean {
  return IMAGE.test(name);
}

/** Natural name order: "slide-2" before "slide-10". */
export const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** `script.md` -> section number -> its lines (one per paragraph). */
export function parseScript(text: string): Map<number, string[]> {
  const sections = new Map<number, string[]>();
  let lines: string[] | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (lines !== undefined && paragraph.length > 0) lines.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const section = SECTION.exec(line);
    if (section !== null) {
      flush();
      lines = [];
      sections.set(Number(section[1]), lines);
    } else if (line.startsWith("#")) {
      flush();
    } else if (line === "") {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return sections;
}

/** The deck from a folder's files: its images by name, each with its script section. */
export function buildDeck(files: readonly { name: string; file: Blob }[], script: string | undefined): Slide[] {
  const sections = script === undefined ? new Map<number, string[]>() : parseScript(script);
  return files
    .filter((f) => isImageName(f.name))
    .sort((a, b) => byName(a.name, b.name))
    .map((f, i) => ({ name: f.name, file: f.file, lines: sections.get(i + 1) ?? [] }));
}

export const lineId = (slide: number, line: number): string => `slide-${slide}-${line}`;

export type DeckCommand =
  | { kind: "stop" }
  | { kind: "slide"; index: number; file: Blob }
  | { kind: "say"; id: string; text: string }
  /** Call `deck.held(token)` after `ms`. */
  | { kind: "hold"; ms: number; token: number }
  | { kind: "done" };

export type DeckPhase = "idle" | "speaking" | "held" | "finished-slide" | "done";

export interface DeckView {
  index: number;
  count: number;
  phase: DeckPhase;
  paused: boolean;
}

export class SlideDeck {
  private index = -1;
  private phase: DeckPhase = "idle";
  private paused = false;
  private waitingFor: string | undefined;
  private token = 0;
  readonly slides: readonly Slide[];

  constructor(slides: readonly Slide[]) {
    this.slides = slides;
  }

  get view(): DeckView {
    return { index: this.index, count: this.slides.length, phase: this.phase, paused: this.paused };
  }

  start(): DeckCommand[] {
    this.paused = false;
    return this.show(0, false);
  }

  next(): DeckCommand[] {
    return this.index < 0 ? this.start() : this.show(this.index + 1, true);
  }

  prev(): DeckCommand[] {
    return this.show(Math.max(0, this.index - 1), this.index >= 0);
  }

  pause(): DeckCommand[] {
    this.paused = true;
    return [];
  }

  resume(): DeckCommand[] {
    this.paused = false;
    return this.phase === "finished-slide" ? this.show(this.index + 1, false) : [];
  }

  /** A `line-end` event from the server. */
  lineEnd(id: string | null): DeckCommand[] {
    if (id === null || id !== this.waitingFor || this.phase !== "speaking") return [];
    this.waitingFor = undefined;
    return this.finished();
  }

  /** The hold of a slide with no lines ran out. */
  held(token: number): DeckCommand[] {
    if (token !== this.token || this.phase !== "held") return [];
    return this.finished();
  }

  /** Stop the deck where it is (the page's Stop also stops the server's speech). */
  end(): DeckCommand[] {
    this.token += 1;
    this.waitingFor = undefined;
    this.phase = this.index < 0 ? "idle" : "done";
    return [];
  }

  private finished(): DeckCommand[] {
    if (this.paused) {
      this.phase = "finished-slide";
      return [];
    }
    return this.show(this.index + 1, false);
  }

  private show(index: number, interrupt: boolean): DeckCommand[] {
    this.token += 1;
    const commands: DeckCommand[] = interrupt ? [{ kind: "stop" }] : [];
    const slide = this.slides[index];
    if (slide === undefined) {
      this.waitingFor = undefined;
      this.phase = "done";
      return [...commands, { kind: "done" }];
    }
    this.index = index;
    commands.push({ kind: "slide", index, file: slide.file });
    if (slide.lines.length === 0) {
      this.waitingFor = undefined;
      this.phase = "held";
      return [...commands, { kind: "hold", ms: HOLD_MS, token: this.token }];
    }
    slide.lines.forEach((text, k) => commands.push({ kind: "say", id: lineId(index, k), text }));
    this.waitingFor = lineId(index, slide.lines.length - 1);
    this.phase = "speaking";
    return commands;
  }
}
