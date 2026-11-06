// @vitest-environment happy-dom
// face-control WP-C: the Face tab, read through what the face (a probe in place of <AvatarCanvas>)
// was given and what the library was asked to keep: the three tabs by keyboard, sliders that start
// at the character's own profile and write a minimal Look.face, the reset, and Look around (off
// under reduced motion).
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, FACE_FIELDS, FACE_LIMITS, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, restoreMotion, setMotion, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import { FACE_GROUPS } from "./FaceCard";
import { LOOK_DWELL_MS, lookPlan } from "./useLookAround";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

/** testRig with its own profile: a narrower gaze range and no chat habit. */
function faceRig(): Rig {
  return { ...testRig(), face: { gaze: { range: 0.4, habits: { chat: 0 } } } };
}

function record(): CharacterRecord {
  const rig = faceRig();
  const assets: Record<string, Blob> = {};
  for (const l of rig.layers) assets[l.file] = new Blob([l.file]);
  return { id: rig.id, rig, assets, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

function library(): Library & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    status: "ready",
    persistent: true,
    entries: [],
    select: () => undefined,
    add: async () => undefined,
    remove: async () => "refused",
    saveLook: async (_id, look) => {
      saved.push(look);
    },
    saveVoice: async () => undefined,
  };
}

const last = (): AvatarCanvasProps => {
  const props = renders.at(-1);
  if (props === undefined) throw new Error("the glass never rendered a face");
  return props;
};

let view: Mounted;
let lib: ReturnType<typeof library>;
const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = view.container.querySelector<T>(sel);
  if (el === null) throw new Error(`nothing matches ${sel}`);
  return el;
};
const slider = (field: string): HTMLInputElement => q<HTMLInputElement>(`[data-face="${field}"]`);
const readout = (field: string): string => slider(field).parentElement?.querySelector("output")?.textContent ?? "";

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function key(el: Element, k: string): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

async function slide(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tab = (name: string): HTMLElement => {
  const found = [...view.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name);
  if (found === undefined) throw new Error(`no tab ${name}`);
  return found;
};

async function open(): Promise<void> {
  view = await mount(<Anatomy record={record()} library={lib} />);
  await elapse(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  renders.length = 0;
  lib = library();
});

afterEach(async () => {
  await view.unmount();
  restoreMotion();
  vi.useRealTimers();
});

describe("the three signal tabs by keyboard", () => {
  it("arrows wrap through Mood, Look and Face; Home and End jump; focus follows; the panel shows", async () => {
    await open();
    expect([...view.container.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["Mood", "Look", "Face"]);
    expect(await key(tab("Mood"), "ArrowRight")).toBe(true);
    expect(await key(tab("Look"), "ArrowRight")).toBe(true);
    expect(tab("Face").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Face"));
    expect(q("#signal-panel-face").hidden).toBe(false);
    expect(q("#signal-panel-look").hidden).toBe(true);
    await key(tab("Face"), "ArrowRight");
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    await key(tab("Mood"), "ArrowLeft");
    expect(tab("Face").getAttribute("aria-selected")).toBe("true");
    await key(tab("Face"), "Home");
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    await key(tab("Mood"), "End");
    expect(tab("Face").getAttribute("aria-selected")).toBe("true");
    expect([tab("Mood").tabIndex, tab("Look").tabIndex, tab("Face").tabIndex]).toEqual([-1, -1, 0]);
  });
});

describe("the Face tab", () => {
  it("has a labelled slider for every face field, bounded by FACE_LIMITS, starting at the character's own profile", async () => {
    await open();
    await click(tab("Face"));
    expect(FACE_GROUPS.flatMap((g) => g.rows.map((r) => r.field)).sort()).toEqual([...FACE_FIELDS].sort());
    for (const field of FACE_FIELDS) {
      const input = slider(field);
      expect([input.min, input.max], field).toEqual(FACE_LIMITS[field].map(String));
      expect(view.container.querySelector(`label[for="${input.id}"]`)?.textContent, field).not.toBe("");
      expect(input.tabIndex, field).not.toBe(-1);
      expect(input.getAttribute("aria-valuetext"), field).toBe(readout(field));
      expect(input.getAttribute("aria-label"), field).toMatch(/^(Gaze|Motion|Expression) /);
    }
    // Rig.face over FACE_DEFAULTS.
    expect([slider("gaze.range").value, readout("gaze.range")]).toEqual(["0.4", "40%"]);
    expect(readout("gaze.habits.chat")).toBe("0%");
    expect([slider("gaze.saccadeRate").value, readout("gaze.saccadeRate")]).toEqual(["1.2", "1.2/s"]);
    expect(readout("motion.breath")).toBe("30%");
    expect(readout("mouth.emotion")).toBe("×1.00");
    expect(q("[data-face-state]").textContent).toBe("The character's own face.");
    expect(q<HTMLButtonElement>("[data-face-reset]").disabled).toBe(true);
  });

  it("a slider writes Look.face live and keeps it; the character's own value is not stored", async () => {
    await open();
    await click(tab("Face"));
    await slide(slider("gaze.range"), "0.8");
    expect(last().look.face).toEqual({ gaze: { range: 0.8 } });
    expect(readout("gaze.range")).toBe("80%");
    await slide(slider("motion.tilt"), "1.5");
    expect(last().look.face).toEqual({ gaze: { range: 0.8 }, motion: { tilt: 1.5 } });
    expect(q("[data-face-state]").textContent).toBe("2 settings changed from the character's own.");
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).toMatchObject({ face: { gaze: { range: 0.8 }, motion: { tilt: 1.5 } } });
    // Back to the rig's own 0.4 and the default ×1: nothing left to store.
    await slide(slider("gaze.range"), "0.4");
    await slide(slider("motion.tilt"), "1");
    expect(last().look.face).toBeUndefined();
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).not.toHaveProperty("face");
  });

  it("Look.face survives other look edits; Reset to character default clears it", async () => {
    await open();
    await click(tab("Face"));
    await slide(slider("expression.strength"), "0.5");
    await slide(slider("mouth.emotion"), "1.25");
    await click(tab("Mood"));
    await click([...view.container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "furious") as HTMLButtonElement);
    expect(last().look.emotion).toBe("furious");
    expect(last().look.face).toEqual({ expression: { strength: 0.5 }, mouth: { emotion: 1.25 } });
    await click(tab("Face"));
    await click(q("[data-face-reset]"));
    expect(last().look.face).toBeUndefined();
    expect(last().look.emotion).toBe("furious");
    expect(readout("expression.strength")).toBe("100%");
    expect(q<HTMLButtonElement>("[data-face-reset]").disabled).toBe(true);
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).not.toHaveProperty("face");
  });

  it("Look around cycles the glass's gaze by the habits (chat skipped at 0) and stops when off", async () => {
    await open();
    await click(tab("Face"));
    expect(last().gaze).toBeUndefined();
    const around = q<HTMLButtonElement>("[data-look-around]");
    await click(around);
    expect(around.getAttribute("aria-pressed")).toBe("true");
    expect(last().gaze).toBe("content");
    await elapse(LOOK_DWELL_MS);
    expect(last().gaze).toBe("host");
    await elapse(LOOK_DWELL_MS);
    expect(last().gaze).toBe("content");
    // The chat habit turned up joins the cycle.
    await slide(slider("gaze.habits.chat"), "0.5");
    expect(lookPlan({ chat: 0.5, content: 1, host: 1 }).map((s) => s.gaze)).toEqual(["chat", "content", "host"]);
    expect(q("[data-motion-state]").textContent).toMatch(/looking to (chat|content|host)$/);
    await click(around);
    expect(last().gaze).toBeUndefined();
    expect(q("[data-motion-state]").textContent).toMatch(/blinking$/);
  });

  it("under reduced motion Look around is off and says so", async () => {
    setMotion("reduced");
    await open();
    await click(tab("Face"));
    const around = q<HTMLButtonElement>("[data-look-around]");
    expect(around.disabled).toBe(true);
    expect(around.getAttribute("aria-pressed")).toBe("false");
    expect(q("#signal-panel-face").textContent).toContain("Look around is off under reduced motion.");
    expect(last().gaze).toBeUndefined();
  });
});
