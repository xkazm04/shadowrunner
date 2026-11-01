// The only place @sr/engine checks external data (tech.md). Parsers take an already-decoded
// value, check its shape, and return undefined when it does not match.
import type { Emotion, Gesture } from "@sr/rig";
import { ENGINE_STATES, PLANES, type EngineState, type Health, type Plane } from "./health.js";
import { EMOTIONS, GESTURES, type ChatMsg, type EngineReply, type ShowBeat, type ShowScript } from "./types.js";

const PLANE_NAMES: readonly string[] = PLANES;
const ENGINE_NAMES: readonly string[] = ENGINE_STATES;

function isPlane(value: unknown): value is Plane {
  return typeof value === "string" && PLANE_NAMES.includes(value);
}

function isEngineState(value: unknown): value is EngineState {
  return typeof value === "string" && ENGINE_NAMES.includes(value);
}

/** Validates a GET /api/health body from the network; extra fields are dropped. */
export function parseHealth(value: unknown): Health | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body: Partial<Record<keyof Health, unknown>> = value;
  const { plane, engine, version } = body;
  if (!isPlane(plane) || !isEngineState(engine) || typeof version !== "string") return undefined;
  return { plane, engine, version };
}

type Fields = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EMOTION_NAMES: readonly string[] = EMOTIONS;
const GESTURE_NAMES: readonly string[] = GESTURES;

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && EMOTION_NAMES.includes(value);
}

export function isGesture(value: unknown): value is Gesture {
  return typeof value === "string" && GESTURE_NAMES.includes(value);
}

/** A recorded reply, checked strictly (no trimming, no repair: the show file is ours). */
function parseRecordedReply(value: unknown): EngineReply | undefined {
  if (!isObject(value)) return undefined;
  const { line, emotion, gesture, answeredId } = value;
  if (typeof line !== "string" || line.length === 0 || !isEmotion(emotion)) return undefined;
  if (gesture !== undefined && !isGesture(gesture)) return undefined;
  if (answeredId !== undefined && typeof answeredId !== "string") return undefined;
  return {
    line,
    emotion,
    ...(gesture === undefined ? {} : { gesture }),
    ...(answeredId === undefined ? {} : { answeredId }),
  };
}

function parseAudienceMsg(value: unknown): ChatMsg | undefined {
  if (!isObject(value)) return undefined;
  const { id, user, text, ts, fictional } = value;
  if (typeof id !== "string" || typeof user !== "string" || typeof text !== "string") return undefined;
  if (typeof ts !== "number" || !Number.isFinite(ts) || fictional !== true) return undefined;
  return { id, user, text, ts, fictional };
}

function parseBeat(value: unknown): ShowBeat | undefined {
  if (!isObject(value)) return undefined;
  const { at, replyTo, reply, wav } = value;
  if (typeof at !== "number" || !Number.isFinite(at) || typeof wav !== "string") return undefined;
  if (replyTo !== undefined && typeof replyTo !== "string") return undefined;
  const parsed = parseRecordedReply(reply);
  if (parsed === undefined) return undefined;
  return { at, ...(replyTo === undefined ? {} : { replyTo }), reply: parsed, wav };
}

function parseAll<T>(values: unknown, parse: (v: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: T[] = [];
  for (const v of values) {
    const parsed = parse(v);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

/**
 * Validates a decoded ShowScript: shape, at least one beat and one generic beat (visitors need
 * one), every `replyTo` naming an audience message. Returns undefined on any mismatch.
 */
export function parseShow(value: unknown): ShowScript | undefined {
  if (!isObject(value)) return undefined;
  const { id, characterId, fictional } = value;
  if (typeof id !== "string" || typeof characterId !== "string" || fictional !== true) return undefined;
  const audience = parseAll(value.audience, parseAudienceMsg);
  const beats = parseAll(value.beats, parseBeat);
  if (audience === undefined || beats === undefined || beats.length === 0) return undefined;
  if (!beats.some((b) => b.replyTo === undefined)) return undefined;
  const ids = new Set(audience.map((m) => m.id));
  if (beats.some((b) => b.replyTo !== undefined && !ids.has(b.replyTo))) return undefined;
  return { id, characterId, fictional, audience, beats };
}

/** Decodes and validates show JSON text (the file under assets/replay/shows/). */
export function parseShowJson(text: string): ShowScript | undefined {
  return parseShow(decodeJson(text));
}

/** Decodes JSON text from outside; undefined when it is not JSON (undefined is never valid JSON). */
export function decodeJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** The parts of a Messages API response body the engine reads. */
export interface MessagesResponse {
  /** Concatenated `text` blocks. */
  text: string;
  stopReason?: string;
}

/** Validates a Messages API response body; undefined when it has no content array. */
export function parseMessagesResponse(text: string): MessagesResponse | undefined {
  const value = decodeJson(text);
  if (!isObject(value) || !Array.isArray(value.content)) return undefined;
  let out = "";
  for (const block of value.content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string") out += block.text;
  }
  const stop = value.stop_reason;
  return typeof stop === "string" ? { text: out, stopReason: stop } : { text: out };
}

/** Decodes JSON text that must be an object; undefined for anything else. */
export function decodeJsonObject(text: string): Readonly<Record<string, unknown>> | undefined {
  const value = decodeJson(text);
  return isObject(value) ? value : undefined;
}
