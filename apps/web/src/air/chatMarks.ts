// The chat lifecycle, one rule (challenge-2026-11-17 air/A): a message's mark on the stage, from the
// picker's state, the beat in flight, the line now spoken and the ids already answered. Pure; the
// show controller (show.ts) derives the snapshot's marks here and Chat.tsx only renders them.
//
// A visitor's message is `queued` while a later pick may still take it (newer than the last pick),
// `pending` once the beat in flight has picked it, `answering` while its line is spoken, `answered`
// after that for as long as it stays on screen, and `passed` when a pick went by it and nothing
// answered it. Any other message is `none` unless it was answered.
import type { ChatMsg } from "@sr/engine";

export type ChatMark = "queued" | "pending" | "answering" | "answered" | "passed" | "none";

/** One mark per chat id. */
export type ChatMarks = Readonly<Record<string, ChatMark>>;

export interface MarkContext {
  /** The picker's `lastPickTs`: visitor messages newer than this may still be picked. */
  lastPickTs: number;
  /** The message the beat in flight answers (show.ts `answering`). */
  answeringId?: string;
  /** The message the line now spoken answers. */
  speakingAnsweredId?: string;
  /** Every message answered so far that is still on screen. */
  answeredIds: ReadonlySet<string>;
}

function markOf(m: ChatMsg, ctx: MarkContext): ChatMark {
  if (m.id === ctx.speakingAnsweredId) return "answering";
  if (ctx.answeredIds.has(m.id)) return "answered";
  if (m.id === ctx.answeringId) return "pending";
  if (m.fromVisitor !== true) return "none";
  return m.ts > ctx.lastPickTs ? "queued" : "passed";
}

export function chatMarks(chat: readonly ChatMsg[], ctx: MarkContext): ChatMarks {
  const marks: Record<string, ChatMark> = {};
  for (const m of chat) marks[m.id] = markOf(m, ctx);
  return marks;
}

/** The answered ids still in `chat`, plus `add`; the same set when nothing changes. */
export function keepAnswered(answered: ReadonlySet<string>, chat: readonly ChatMsg[], add?: string): ReadonlySet<string> {
  const onScreen = new Set(chat.map((m) => m.id));
  const kept = [...answered].filter((id) => onScreen.has(id));
  const grows = add !== undefined && onScreen.has(add) && !answered.has(add);
  if (kept.length === answered.size && !grows) return answered;
  return new Set(grows ? [...kept, add] : kept);
}

/** Two mark records say the same thing. */
export function sameMarks(a: ChatMarks | undefined, b: ChatMarks): boolean {
  if (a === undefined) return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((k) => a[k] === b[k]);
}
