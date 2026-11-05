// timeline.jsonl: every event the director emitted, one JSON object per line, in emission order.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { EMOTIONS, GESTURES } from "@sr/engine";
import { SCENE_OPS, VISEMES, type SceneArgs, type TimelineEvent } from "../contract.js";
import { isFiniteNumber, isRecord, oneOf, parseJson, type JsonRecord } from "./json.js";

const str = (v: unknown): v is string => typeof v === "string";

function parseScene(v: JsonRecord): SceneArgs | undefined {
  if (!oneOf(SCENE_OPS, v.op)) return undefined;
  switch (v.op) {
    case "light":
      return oneOf(["dim", "warm", "cold", "flicker", "blackout"] as const, v.cue) ? { op: "light", cue: v.cue } : undefined;
    case "candles":
      return oneOf(["burst", "dim", "steady"] as const, v.action) ? { op: "candles", action: v.action } : undefined;
    case "card":
      if (!oneOf(["show", "hide"] as const, v.action) || !str(v.id)) return undefined;
      return { op: "card", action: v.action, id: v.id, ...(str(v.title) ? { title: v.title } : {}), ...(str(v.body) ? { body: v.body } : {}) };
    case "caption":
      return oneOf(["plain", "whisper", "shout"] as const, v.style) ? { op: "caption", style: v.style } : undefined;
    case "poll": {
      if (!oneOf(["open", "close"] as const, v.action)) return undefined;
      const options = Array.isArray(v.options) && v.options.every(str) ? v.options.filter(str) : undefined;
      return {
        op: "poll",
        action: v.action,
        ...(str(v.question) ? { question: v.question } : {}),
        ...(options === undefined ? {} : { options }),
      };
    }
  }
}

/** One validated TimelineEvent, or undefined. */
export function parseTimelineEvent(value: unknown): TimelineEvent | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.t)) return undefined;
  const { t } = value;
  switch (value.kind) {
    case "turn": {
      const c = value.chat;
      if (!isFiniteNumber(value.turn) || !isRecord(c) || !str(c.id) || !str(c.user) || !str(c.text) || !isFiniteNumber(c.atMs)) return undefined;
      return { t, kind: "turn", turn: value.turn, chat: { id: c.id, user: c.user, text: c.text, atMs: c.atMs } };
    }
    case "say":
      return str(value.id) && str(value.text) ? { t, kind: "say", id: value.id, text: value.text } : undefined;
    case "audio":
      return str(value.id) && isFiniteNumber(value.sampleRate) && str(value.pcmRef) && isFiniteNumber(value.durationMs)
        ? { t, kind: "audio", id: value.id, sampleRate: value.sampleRate, pcmRef: value.pcmRef, durationMs: value.durationMs }
        : undefined;
    case "viseme":
      return str(value.id) && oneOf(VISEMES, value.v) && isFiniteNumber(value.startMs) && isFiniteNumber(value.endMs)
        ? { t, kind: "viseme", id: value.id, v: value.v, startMs: value.startMs, endMs: value.endMs }
        : undefined;
    case "emotion":
      return oneOf(EMOTIONS, value.value) ? { t, kind: "emotion", value: value.value } : undefined;
    case "gesture":
      return oneOf(GESTURES, value.value) ? { t, kind: "gesture", value: value.value } : undefined;
    case "scene": {
      const scene = parseScene(value);
      return scene === undefined ? undefined : { t, kind: "scene", ...scene };
    }
    case "mark":
      return str(value.name) ? { t, kind: "mark", name: value.name } : undefined;
    default:
      return undefined;
  }
}

/** Reads timeline.jsonl; a line that is not a valid event throws with its line number. */
export function readTimeline(path: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim() === "") return;
      const event = parseTimelineEvent(parseJson(line));
      if (event === undefined) throw new Error(`${path}:${i + 1} is not a timeline event.`);
      events.push(event);
    });
  return events;
}

/** Appends events to timeline.jsonl as they are emitted (a crash keeps everything so far). */
export class TimelineWriter {
  readonly events: TimelineEvent[] = [];
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    writeFileSync(path, "");
  }

  write(event: TimelineEvent): void {
    this.events.push(event);
    appendFileSync(this.#path, `${JSON.stringify(event)}\n`);
  }
}
