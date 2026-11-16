// The control page's history (spec flashhead-live, task 3.3): the lines it sent (typed and slide
// lines) with their timing, and the chat thread with Iris's replies as spoken. Pure reducers over
// the server's messages, so the matching rules (by id; a null-id reply joins the latest turn) are
// unit-tested.
import type { ServerMessage } from "./protocol";

export const HISTORY_CAP = 50;

export type LineStatus = "sent" | "speaking" | "done" | "error";

export interface LineRecord {
  id: string;
  text: string;
  origin: "line" | "slide";
  status: LineStatus;
  /** Stream clock (ms) of the line's first audio sample, and of its end. */
  startMs?: number;
  endMs?: number;
  firstFrameMs?: number;
  chunkMs?: number;
  upscaleMs?: number | null;
  error?: string;
}

export function addLine(lines: readonly LineRecord[], line: LineRecord): LineRecord[] {
  return [line, ...lines].slice(0, HISTORY_CAP);
}

const patch = <T extends { id: string }>(items: readonly T[], id: string | null, change: (item: T) => T): T[] =>
  id === null || !items.some((i) => i.id === id) ? [...items] : items.map((i) => (i.id === id ? change(i) : i));

export function updateLines(lines: readonly LineRecord[], message: ServerMessage): LineRecord[] {
  if (message.type === "timing") {
    const { firstFrameMs, chunkMs, upscaleMs } = message;
    return patch(lines, message.id, (l) => ({ ...l, firstFrameMs, chunkMs, upscaleMs }));
  }
  if (message.type !== "event") return [...lines];
  const { kind, id, atMs, text } = message;
  if (kind === "line-start") return patch(lines, id, (l) => ({ ...l, status: "speaking", startMs: atMs }));
  if (kind === "line-end") return patch(lines, id, (l) => ({ ...l, status: "done", endMs: atMs }));
  if (kind === "error") return patch(lines, id, (l) => ({ ...l, status: "error", error: text ?? "The server refused this line." }));
  return [...lines];
}

/** How long the line played (ms), once it ended. */
export const lineLengthMs = (line: LineRecord): number | undefined =>
  line.startMs === undefined || line.endMs === undefined ? undefined : Math.max(0, line.endMs - line.startMs);

export interface ChatTurn {
  id: string;
  text: string;
  /** Iris's reply, sentence by sentence, as spoken. */
  reply: string[];
  status: "waiting" | "replying" | "done" | "error";
  error?: string;
}

export function addTurn(turns: readonly ChatTurn[], turn: ChatTurn): ChatTurn[] {
  return [...turns, turn].slice(-HISTORY_CAP);
}

export function updateChat(turns: readonly ChatTurn[], message: ServerMessage): ChatTurn[] {
  if (message.type !== "event") return [...turns];
  const { kind, text } = message;
  // A reply without an id belongs to the latest turn.
  const id = message.id ?? turns.at(-1)?.id ?? null;
  if (kind === "reply-text" && text !== null) return patch(turns, id, (t) => ({ ...t, status: "replying", reply: [...t.reply, text] }));
  if (kind === "line-end") return patch(turns, message.id, (t) => ({ ...t, status: "done" }));
  if (kind === "error" && message.id !== null) return patch(turns, message.id, (t) => ({ ...t, status: "error", error: text ?? "Iris could not answer." }));
  return [...turns];
}

/** The latest error event that no line or turn claimed (shown under the toolbar). */
export function looseError(message: ServerMessage, known: (id: string) => boolean): string | undefined {
  if (message.type !== "event" || message.kind !== "error") return undefined;
  if (message.id !== null && known(message.id)) return undefined;
  return message.text ?? "The live server reported an error.";
}
