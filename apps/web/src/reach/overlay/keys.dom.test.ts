// @vitest-environment happy-dom
// The overlay's keys (spec avatar-reach 3.4, design "Testing"): 1-6 cover the six expression
// families, 0 is neutral, G the gesture; owned keys never reach a window bubble listener (the
// shell's keymap), other keys (Esc) still do.
import { EMOTION_FAMILY, EXPRESSION_FAMILIES } from "@sr/rig";
import { afterEach, describe, expect, it } from "vitest";
import { listenOverlayKeys, MOOD_KEYS, overlayKeyAction, type OverlayKeyAction } from "./keys";

describe("MOOD_KEYS", () => {
  it("maps 1-6 to one emotion per family, in family order, and 0 to neutral", () => {
    expect(Object.keys(MOOD_KEYS).sort()).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(MOOD_KEYS["0"]).toBe("neutral");
    const families = ["1", "2", "3", "4", "5", "6"].map((key) => EMOTION_FAMILY[MOOD_KEYS[key] ?? "neutral"]);
    expect(families).toEqual([...EXPRESSION_FAMILIES]);
  });

  it("picks the first emotion of each family in table order", () => {
    expect(MOOD_KEYS).toMatchObject({ "1": "amused", "2": "theatrical", "3": "irritated", "4": "bored", "5": "smug", "6": "suspicious" });
  });
});

describe("overlayKeyAction", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
    overlayKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it("owns the mood digits and G (either case), nothing else", () => {
    expect(key("3")).toEqual({ kind: "mood", emotion: "irritated" });
    expect(key("0")).toEqual({ kind: "mood", emotion: "neutral" });
    expect(key("g")).toEqual({ kind: "gesture", gesture: "nod" });
    expect(key("G")).toEqual({ kind: "gesture", gesture: "nod" });
    for (const other of ["7", "9", "Escape", "t", "ArrowLeft"]) expect(key(other)).toBeUndefined();
  });

  it("leaves modified keys to the browser and the shell", () => {
    expect(key("1", { ctrlKey: true })).toBeUndefined();
    expect(key("g", { metaKey: true })).toBeUndefined();
    expect(key("2", { altKey: true })).toBeUndefined();
  });
});

describe("listenOverlayKeys", () => {
  let stop: (() => void) | undefined;
  let shell: ((event: KeyboardEvent) => void) | undefined;
  afterEach(() => {
    stop?.();
    if (shell) window.removeEventListener("keydown", shell);
    stop = undefined;
    shell = undefined;
  });

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  }

  it("takes its keys before the shell's window listener and lets the rest through", () => {
    const seen: OverlayKeyAction[] = [];
    const shellHeard: string[] = [];
    shell = (event) => shellHeard.push(event.key);
    window.addEventListener("keydown", shell);
    stop = listenOverlayKeys(window, (action) => seen.push(action));

    expect(press("1").defaultPrevented).toBe(true);
    press("G");
    press("Escape");
    press("t");

    expect(seen).toEqual([
      { kind: "mood", emotion: "amused" },
      { kind: "gesture", gesture: "nod" },
    ]);
    expect(shellHeard).toEqual(["Escape", "t"]);
  });

  it("swallows a held key's repeats without acting again, and stops on cleanup", () => {
    const seen: OverlayKeyAction[] = [];
    stop = listenOverlayKeys(window, (action) => seen.push(action));
    press("2");
    press("2", { repeat: true });
    stop();
    stop = undefined;
    press("3");
    expect(seen).toEqual([{ kind: "mood", emotion: "theatrical" }]);
  });
});
