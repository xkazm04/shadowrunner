// Overlord's transcript.jsonl (StreamEvent per line, ts_ms from session start) -> lab timeline
// events on the recording's clock: each chat line becomes a `turn` (Overlord answers from a
// simulated room, so every arriving message is a candidate), each host `say` a `say`. `offsetMs` is
// how long after the session start the recording began (t = ts_ms - offsetMs; earlier lines drop).
import type { TimelineEvent } from "../contract.js";
import { isRecord, type JsonRecord } from "../director/json.js";

const rec = (v: unknown): JsonRecord | undefined => (isRecord(v) ? v : undefined);

export function transcriptToTimeline(text: string, offsetMs: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  let turn = 0;
  let says = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let e: JsonRecord | undefined;
    try {
      e = rec(JSON.parse(line));
    } catch {
      continue;
    }
    const ts = e?.ts_ms;
    if (e === undefined || typeof ts !== "number") continue;
    const t = Math.round(ts - offsetMs);
    if (t < 0) continue;
    if (e.type === "chat") {
      const msg = rec(e.msg);
      const viewer = rec(msg?.viewer);
      if (typeof msg?.id !== "string" || typeof msg.text !== "string") continue;
      turn += 1;
      out.push({ t, kind: "turn", turn, chat: { id: msg.id, user: typeof viewer?.name === "string" ? viewer.name : "viewer", text: msg.text, atMs: t } });
    } else if (e.type === "say" && typeof e.text === "string") {
      says += 1;
      out.push({ t, kind: "say", id: `say-${says}`, text: e.text });
    }
  }
  return out;
}
