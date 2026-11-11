// @vitest-environment happy-dom
// perfection-pass task 7 (creator history, F2): a look edit is undone and redone (buttons and keys,
// a slider drag being one step), Compare holds the look as opened on the glass, the name is renamed
// and duplicated from the header, and a pending look save is never dropped (switch, unmount,
// pagehide). <AvatarCanvas> is a probe that keeps every props object, as in Anatomy.dom.test.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, type Look } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildKeymap, normalizeHotkey } from "../../app/keys";
import { PAGES } from "../../app/pages";
import { elapse, mount, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import { forgetHistories, HISTORY_KEYS } from "./useLookHistory";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

function record(id = "test-ghost"): CharacterRecord {
  const rig = testRig(id);
  return { id, rig, assets: {}, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

function library() {
  const saved: { id: string; look: Look }[] = [];
  /** Every library write, in order. */
  const calls: string[] = [];
  const lib: Library = {
    status: "ready",
    persistent: true,
    entries: [],
    select: () => undefined,
    add: async () => undefined,
    remove: async () => "refused",
    saveLook: async (id, look) => {
      calls.push(`saveLook ${id}`);
      saved.push({ id, look });
    },
    saveVoice: async () => undefined,
    rename: async (id, name) => {
      calls.push(`rename ${id} ${name}`);
      return "renamed";
    },
    duplicate: async (id) => {
      calls.push(`duplicate ${id}`);
      return `${id}-2`;
    },
  };
  return { lib, saved, calls };
}

const last = (): AvatarCanvasProps => {
  const props = renders.at(-1);
  if (props === undefined) throw new Error("the glass never rendered a face");
  return props;
};

let view: Mounted | undefined;
let lib: ReturnType<typeof library>;

function named(name: string): HTMLElement {
  const found = [...(view?.container.querySelectorAll<HTMLElement>("button,input") ?? [])].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  if (found === undefined) throw new Error(`no control named ${name}`);
  return found;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function fire(target: EventTarget, event: Event): Promise<boolean> {
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });

async function slide(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function slider(field: string): HTMLInputElement {
  const el = view?.container.querySelector<HTMLInputElement>(`[data-face="${field}"]`);
  if (el === null || el === undefined) throw new Error(`no slider ${field}`);
  return el;
}

const disabled = (name: string): boolean => (named(name) as HTMLButtonElement).disabled;

async function reopen(r: CharacterRecord): Promise<void> {
  await view?.unmount();
  view = await mount(<Anatomy record={r} library={lib.lib} />);
  await elapse(0);
}

beforeEach(async () => {
  forgetHistories();
  vi.useFakeTimers();
  renders.length = 0;
  lib = library();
  view = await mount(<Anatomy record={record()} library={lib.lib} />);
  await elapse(0);
});

afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

describe("a pending look save is flushed (requirement 7.4)", () => {
  it("on unmount (a character switch remounts the editor), inside the save delay", async () => {
    await click(named("crown on the face"));
    expect(lib.saved).toHaveLength(0);
    await view?.unmount();
    view = undefined;
    expect(lib.saved.map((s) => s.look.hidden)).toEqual([["crown"]]);
  });

  it("on pagehide, once, and not again when the timer would have fired", async () => {
    await click(named("crown on the face"));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(lib.saved.map((s) => s.look.hidden)).toEqual([["crown"]]);
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved).toHaveLength(1);
  });

  it("nothing is written when nothing changed", async () => {
    await view?.unmount();
    view = undefined;
    expect(lib.saved).toHaveLength(0);
  });
});

describe("undo and redo (requirement 7.1)", () => {
  it("buttons step a look edit back and forth, disabled when there is nothing to step to", async () => {
    expect([disabled("Undo look change"), disabled("Redo look change")]).toEqual([true, true]);
    await click(named("crown on the face"));
    expect(last().look.hidden).toEqual(["crown"]);
    expect([disabled("Undo look change"), disabled("Redo look change")]).toEqual([false, true]);
    await click(named("Undo look change"));
    expect(last().look.hidden).toEqual([]);
    expect([disabled("Undo look change"), disabled("Redo look change")]).toEqual([true, false]);
    await click(named("Redo look change"));
    expect(last().look.hidden).toEqual(["crown"]);
  });

  it("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, on window (Cmd too)", async () => {
    await click(named("crown on the face"));
    expect(await fire(window, keydown("z", { ctrlKey: true }))).toBe(true);
    expect(last().look.hidden).toEqual([]);
    await fire(window, keydown("Z", { ctrlKey: true, shiftKey: true }));
    expect(last().look.hidden).toEqual(["crown"]);
    await fire(window, keydown("z", { metaKey: true }));
    expect(last().look.hidden).toEqual([]);
    await fire(window, keydown("y", { ctrlKey: true }));
    expect(last().look.hidden).toEqual(["crown"]);
  });

  it("the keys leave a text field alone, but not a slider", async () => {
    await click(named("crown on the face"));
    await click(named("Rename Test Ghost"));
    const field = view?.container.querySelector<HTMLInputElement>("[data-name-field]");
    if (field === null || field === undefined) throw new Error("no name field");
    expect(await fire(field, keydown("z", { ctrlKey: true }))).toBe(false);
    expect(last().look.hidden).toEqual(["crown"]);
    expect(await fire(slider("gaze.range"), keydown("z", { ctrlKey: true }))).toBe(true);
    expect(last().look.hidden).toEqual([]);
  });

  it("the shell's keymap binds none of the history keys (no clash)", () => {
    const keymap = buildKeymap(PAGES);
    for (const k of [...HISTORY_KEYS.undo, ...HISTORY_KEYS.redo]) expect(keymap.get(normalizeHotkey(k))).toBeUndefined();
  });

  it("a slider drag is one step; pointer-up or a pause ends it", async () => {
    const own = slider("gaze.range").value;
    for (const v of ["0.5", "0.6", "0.7", "0.8"]) {
      await slide(slider("gaze.range"), v);
      await elapse(100);
    }
    await click(named("Undo look change"));
    expect(slider("gaze.range").value).toBe(own);
    expect(disabled("Undo look change")).toBe(true);
    await click(named("Redo look change"));
    expect(slider("gaze.range").value).toBe("0.8");
    // A second drag after pointer-up is its own step, however soon it starts.
    await slide(slider("gaze.range"), "0.3");
    await fire(window, new Event("pointerup"));
    await slide(slider("gaze.range"), "0.2");
    await click(named("Undo look change"));
    expect(slider("gaze.range").value).toBe("0.3");
    // ... and so is one after a pause longer than the coalescing window.
    await elapse(600);
    await slide(slider("gaze.range"), "0.25");
    await elapse(600);
    await slide(slider("gaze.range"), "0.35");
    await click(named("Undo look change"));
    expect(slider("gaze.range").value).toBe("0.25");
  });

  it("mouth size on a morph rig (companion-lanes round 6) is one step per drag, undone and redone like its neighbours", async () => {
    const rig = testRig("morph-ghost");
    const morph = { layer: "head", atlas: "a.webp", keys: [{ id: "open_mid", track: "openMid" as const, bbox: [24, 28, 16, 8] as [number, number, number, number], cell: [0, 0, 16, 8] as [number, number, number, number] }], eyes: [[25, 20], [39, 20]] as [[number, number], [number, number]] };
    await reopen({ ...record("morph-ghost"), rig: { ...rig, morph } });
    expect(slider("mouth.size").value).toBe("1");
    for (const v of ["0.9", "0.8", "0.7"]) await slide(slider("mouth.size"), v);
    expect(last().look.face).toEqual({ mouth: { size: 0.7 } });
    await click(named("Undo look change"));
    expect(slider("mouth.size").value).toBe("1");
    expect(last().look.face).toBeUndefined();
    await click(named("Redo look change"));
    expect(slider("mouth.size").value).toBe("0.7");
  });

  it("Reset look can be undone", async () => {
    await click(named("crown on the face"));
    await click(named("Reset look"));
    expect(last().look.hidden).toEqual([]);
    await click(named("Undo look change"));
    expect(last().look.hidden).toEqual(["crown"]);
  });

  it("history is per character for the session: kept across a switch, fresh for another character", async () => {
    await click(named("crown on the face"));
    await reopen(record("other-ghost"));
    expect(disabled("Undo look change")).toBe(true);
    const saved = lib.saved.find((s) => s.id === "test-ghost")?.look;
    expect(saved?.hidden).toEqual(["crown"]);
    await reopen({ ...record(), look: saved ?? defaultLook(testRig()) });
    expect(disabled("Undo look change")).toBe(false);
    await click(named("Undo look change"));
    expect(last().look.hidden).toEqual([]);
  });
});

describe("Compare (requirement 7.2)", () => {
  const LABEL = "Hold to compare with the look as opened";
  const tag = (): Element | null | undefined => view?.container.querySelector("[data-compare-tag]");

  it("is disabled while the look is the one opened", async () => {
    expect(disabled(LABEL)).toBe(true);
    await click(named("crown on the face"));
    expect(disabled(LABEL)).toBe(false);
  });

  it("held with the pointer, shows the look as opened with a before tag; released, the edit", async () => {
    await click(named("crown on the face"));
    await fire(named(LABEL), new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    expect(last().look).toEqual(defaultLook(testRig()));
    expect(tag()?.textContent).toMatch(/before/i);
    expect(named(LABEL).getAttribute("aria-pressed")).toBe("true");
    await fire(named(LABEL), new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(last().look.hidden).toEqual(["crown"]);
    expect(tag()).toBeNull();
    // Comparing is not an edit: the crown is all that is saved.
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.map((s) => s.look.hidden)).toEqual([["crown"]]);
  });

  it("held with Space or Enter from the keyboard; leaving it lets go", async () => {
    await click(named("crown on the face"));
    await fire(named(LABEL), keydown(" "));
    expect(last().look.hidden).toEqual([]);
    expect(tag()).not.toBeNull();
    await fire(named(LABEL), new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    expect(last().look.hidden).toEqual(["crown"]);
    await act(async () => named(LABEL).focus());
    await fire(named(LABEL), keydown("Enter"));
    expect(last().look.hidden).toEqual([]);
    await act(async () => named(LABEL).blur());
    expect(last().look.hidden).toEqual(["crown"]);
  });
});

describe("rename and duplicate (requirement 7.3)", () => {
  async function field(): Promise<HTMLInputElement> {
    await click(named("Rename Test Ghost"));
    const el = view?.container.querySelector<HTMLInputElement>("[data-name-field]");
    if (el === null || el === undefined) throw new Error("no name field");
    return el;
  }

  it("the name becomes a field; Enter keeps a new name, Esc and an empty name keep the old", async () => {
    let el = await field();
    el.value = "Night Ghost";
    expect(await fire(el, keydown("Escape"))).toBe(true);
    expect(lib.calls).toEqual([]);
    el = await field();
    el.value = "   ";
    await fire(el, keydown("Enter"));
    expect(lib.calls).toEqual([]);
    expect(view?.container.textContent).toContain("A character needs a name");
    el = await field();
    el.value = "  Night   Ghost ";
    await fire(el, keydown("Enter"));
    expect(lib.calls).toEqual(["rename test-ghost Night Ghost"]);
  });

  it("Duplicate writes the pending look first, then makes the variant", async () => {
    await click(named("crown on the face"));
    await click(named("Duplicate Test Ghost as a variant"));
    expect(lib.calls).toEqual(["saveLook test-ghost", "duplicate test-ghost"]);
    expect(lib.saved.at(-1)?.look.hidden).toEqual(["crown"]);
  });

  it("the house character keeps his name, but may be duplicated", async () => {
    await reopen({ ...record(), seeded: true });
    expect(() => named("Rename Test Ghost")).toThrow();
    expect(view?.container.textContent).toContain("Test Ghost");
    expect(named("Duplicate Test Ghost as a variant")).toBeDefined();
  });
});
