// The single keymap: one hotkey per page from the manifest plus the shell's global keys
// (m0-spine design "Page manifest"; landing requirement 5.3). Hotkeys are written for people
// ("O", "Ctrl+K", "Esc") and compared in a normalised, case-insensitive form.
import { useEffect, useRef } from "react";
import { channelPages, type PageDef, type PageId } from "./pages";
import { normalizePath } from "./router";

export type KeyAction =
  | { kind: "go"; pageId: PageId }
  | { kind: "channel"; step: -1 | 1 }
  | { kind: "back" }
  | { kind: "daemon-sample" }
  | { kind: "goto" }
  | { kind: "theme" };

export interface Binding {
  hotkey: string;
  label: string;
  action: KeyAction;
}

export const GLOBAL_BINDINGS: readonly Binding[] = [
  { hotkey: "ArrowLeft", label: "Previous channel", action: { kind: "channel", step: -1 } },
  { hotkey: "ArrowRight", label: "Next channel", action: { kind: "channel", step: 1 } },
  { hotkey: "Esc", label: "Back to the set", action: { kind: "back" } },
  { hotkey: "D", label: "Daemon sample (replay only)", action: { kind: "daemon-sample" } },
  { hotkey: "Ctrl+K", label: "Go to", action: { kind: "goto" } },
  { hotkey: "T", label: "Toggle theme", action: { kind: "theme" } },
];

const MODIFIER_ORDER = ["ctrl", "alt", "shift"];
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  control: "ctrl",
  cmd: "ctrl",
  meta: "ctrl",
  mod: "ctrl",
  option: "alt",
};
const KEY_ALIASES: Readonly<Record<string, string>> = { esc: "escape" };

/**
 * Canonical form: lowercase, modifiers in ctrl/alt/shift order, Cmd folded into Ctrl, "Esc" as
 * "escape". Shift is dropped for single characters, so "O" and "Shift+o" are the same key.
 */
export function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split("+");
  let key = parts.pop() ?? "";
  if (key === "" && parts.length > 0) {
    parts.pop();
    key = "+";
  }
  key = key.length === 1 ? key.toLowerCase() : key.trim().toLowerCase();
  key = KEY_ALIASES[key] ?? key;
  const mods = new Set(
    parts.map((m) => {
      const mod = m.trim().toLowerCase();
      return MODIFIER_ALIASES[mod] ?? mod;
    }),
  );
  if (key.length === 1) mods.delete("shift");
  const rank = (m: string) => (MODIFIER_ORDER.includes(m) ? MODIFIER_ORDER.indexOf(m) : MODIFIER_ORDER.length);
  const ordered = [...mods].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [...ordered, key].join("+");
}

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** The normalised hotkey a keydown produces, or undefined for a bare modifier press. */
export function eventHotkey(event: KeyLike): string | undefined {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(event.key)) return undefined;
  const mods: string[] = [];
  if (event.ctrlKey || event.metaKey) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  return normalizeHotkey([...mods, event.key].join("+"));
}

/** The fields uniqueness is judged on; any PageDef is one. */
export interface ManifestEntry {
  id: string;
  hotkey: string;
  path: string;
}

export interface Conflict {
  kind: "hotkey" | "path";
  /** The normalised hotkey or path. */
  value: string;
  /** Page ids, and `global:<label>` for global bindings. */
  owners: string[];
}

function clashes(kind: Conflict["kind"], owned: readonly (readonly [string, string])[]): Conflict[] {
  const byValue = new Map<string, string[]>();
  for (const [value, owner] of owned) byValue.set(value, [...(byValue.get(value) ?? []), owner]);
  return [...byValue]
    .filter(([, owners]) => owners.length > 1)
    .map(([value, owners]) => ({ kind, value, owners }));
}

/** Every hotkey or path claimed twice across the manifest and the global bindings. */
export function findConflicts(
  pages: readonly ManifestEntry[],
  globals: readonly Binding[] = GLOBAL_BINDINGS,
): Conflict[] {
  const hotkeys = [
    ...pages.map((p) => [normalizeHotkey(p.hotkey), p.id] as const),
    ...globals.map((g) => [normalizeHotkey(g.hotkey), `global:${g.label}`] as const),
  ];
  const paths = pages.map((p) => [normalizePath(p.path), p.id] as const);
  return [...clashes("hotkey", hotkeys), ...clashes("path", paths)];
}

/** Normalised hotkey -> action. Throws, naming each clash, if the manifest is not unique. */
export function buildKeymap(
  pages: readonly PageDef[],
  globals: readonly Binding[] = GLOBAL_BINDINGS,
): ReadonlyMap<string, KeyAction> {
  const conflicts = findConflicts(pages, globals);
  if (conflicts.length > 0) {
    const detail = conflicts.map((c) => `${c.kind} "${c.value}" is claimed by ${c.owners.join(", ")}`);
    throw new Error(`Page manifest is not unique: ${detail.join("; ")}`);
  }
  return new Map<string, KeyAction>([
    ...pages.map((p) => [normalizeHotkey(p.hotkey), { kind: "go", pageId: p.id }] as const),
    ...globals.map((g) => [normalizeHotkey(g.hotkey), g.action] as const),
  ]);
}

/** The next (+1) or previous (-1) channel on the dial, wrapping; undefined off the dial. */
export function stepChannel(pages: readonly PageDef[], current: PageId | undefined, step: -1 | 1): PageDef | undefined {
  const dial = channelPages(pages);
  const at = dial.findIndex((p) => p.id === current);
  if (at < 0) return undefined;
  return dial[(at + step + dial.length) % dial.length];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Listens on window and hands each bound key to `onAction`. Keys typed into fields, repeats and
 * IME composition are ignored. `onAction` returns true when it handled the key (preventDefault).
 */
export function useHotkeys(keymap: ReadonlyMap<string, KeyAction>, onAction: (action: KeyAction) => boolean): void {
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || isTypingTarget(event.target)) return;
      const hotkey = eventHotkey(event);
      const action = hotkey === undefined ? undefined : keymap.get(hotkey);
      if (action && handler.current(action)) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keymap]);
}
