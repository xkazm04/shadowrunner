// The look with its history (perfection-pass task 7): Anatomy's look reducer wrapped in
// customize/lookHistory. Every LookAction is one step but those of one slider or one colour, which
// coalesce (lookHistory COALESCE_MS, sealed on pointer-up anywhere), so a drag is one step. Reset
// look is a step too, so it can be undone.
// - History is per character for the session: kept in a module map by record id and createdAt, so
//   switching away and back (the editor remounts) keeps it, and a reload starts afresh. A kept
//   history is used only while its present is the record's stored look; when the record changed
//   under it (another tab, an import over it) the character starts a new history.
// - Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac), on window, except while a text
//   field has focus (its own undo wins) or inside a dialog. Sliders and colour inputs are not text
//   fields. The shell's keymap (app/keys.ts) binds none of these keys.
import { type Look } from "@sr/rig";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { canRedo, canUndo, createHistory, push, redo, seal, undo, type History } from "../customize/lookHistory";
import { lookReducer, type LookAction } from "../customize/lookReducer";

/** The keys this hook answers, as people write them (checked against the shell keymap in tests). */
export const HISTORY_KEYS = { undo: ["Ctrl+Z"], redo: ["Ctrl+Shift+Z", "Ctrl+Y"] } as const;

const sessions = new Map<string, History<Look>>();

/** Test hook: forgets every character's history. */
export function forgetHistories(): void {
  sessions.clear();
}

/** The control a change comes from, for coalescing; undefined for a discrete change. */
export function groupOf(action: LookAction): string | undefined {
  switch (action.type) {
    case "palette":
      return `palette:${action.key}`;
    case "region":
      return action.value === undefined || action.value === null ? undefined : `region:${action.key}`;
    case "shape":
      return `shape:${action.layer}:${Object.keys(action.value).sort().join(",")}`;
    case "face":
      return `face:${action.field}`;
    default:
      return undefined;
  }
}

type Msg = { type: "act"; action: LookAction; at: number } | { type: "undo" } | { type: "redo" } | { type: "seal" };

function reduce(h: History<Look>, msg: Msg): History<Look> {
  switch (msg.type) {
    case "act": {
      const group = groupOf(msg.action);
      return push(h, lookReducer(h.present, msg.action), { at: msg.at, ...(group === undefined ? {} : { group }) });
    }
    case "undo":
      return undo(h);
    case "redo":
      return redo(h);
    case "seal":
      return seal(h);
  }
}

const sameLook = (a: Look, b: Look): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

function begin(key: string, look: Look): History<Look> {
  const kept = sessions.get(key);
  return kept !== undefined && sameLook(kept.present, look) ? kept : createHistory(look);
}

/** A focused field whose own Ctrl+Z should win. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target.getAttribute("type") ?? "text").toLowerCase();
  return !["range", "color", "checkbox", "radio", "button", "submit", "reset"].includes(type);
}

/** undo, redo or nothing for a keydown. */
export function historyKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): "undo" | "redo" | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return undefined;
}

export interface LookHistory {
  look: Look;
  /** The look as the character was opened (the Compare baseline). */
  opened: Look;
  dispatch(action: LookAction): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useLookHistory(record: { id: string; createdAt: string; look: Look }): LookHistory {
  const key = `${record.id}@${record.createdAt}`;
  const [h, send] = useReducer(reduce, undefined, () => begin(key, record.look));

  useEffect(() => {
    sessions.set(key, h);
  }, [key, h]);

  // A drag ends at pointer-up, wherever it lands.
  useEffect(() => {
    const end = (): void => send({ type: "seal" });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || isTextField(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[role=dialog]") !== null) return;
      const which = historyKey(event);
      if (which === undefined) return;
      event.preventDefault();
      send({ type: which });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dispatch = useCallback((action: LookAction) => send({ type: "act", action, at: Date.now() }), []);
  const actions = useMemo(() => ({ undo: () => send({ type: "undo" }), redo: () => send({ type: "redo" }) }), []);

  return { look: h.present, opened: h.opened, dispatch, ...actions, canUndo: canUndo(h), canRedo: canRedo(h) };
}
