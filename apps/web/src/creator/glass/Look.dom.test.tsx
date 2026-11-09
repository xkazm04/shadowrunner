// @vitest-environment happy-dom
// character-control task 4: the Mood / Look tabs, the Palette card's region chips, the glass pick
// and the Shape card, read through what the face (a probe in place of <AvatarCanvas>) was given
// and what the library was asked to keep.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, SHAPE_LIMITS, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, restoreMotion, setMotion, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import type { Pixels } from "./pick";
import { OUTLINE_MS } from "./usePick";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

/** testRig with two colour regions on the head: the left half "hood", the right half "hood 2". */
export function regionRig(): Rig {
  const rig = testRig();
  return {
    ...rig,
    layers: rig.layers.map((l) =>
      l.name === "head"
        ? { ...l, regions: { map: "head.regions.png", slots: [{ id: "r1", name: "hood", hex: "#334455" }, { id: "r2", name: "hood 2", hex: "#556677" }] } }
        : l,
    ),
  };
}

/** A `w` x `h` image: every pixel `rgba(x, y)`. */
export function image(w: number, h: number, rgba: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data.set(rgba(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** Opaque images the size of each layer's bbox (so 1 image px = 1 rig px); the head's map split in two. */
export function fixturePixels(rig: Rig): Record<string, Pixels> {
  const out: Record<string, Pixels> = {};
  for (const l of rig.layers) out[l.file] = image(l.bbox[2], l.bbox[3], () => [200, 200, 200, 255]);
  const head = rig.layers.find((l) => l.name === "head");
  if (head !== undefined) out["head.regions.png"] = image(head.bbox[2], head.bbox[3], (x) => [x < head.bbox[2] / 2 ? 1 : 2, 0, 0, 255]);
  return out;
}

function record(): CharacterRecord {
  const rig = regionRig();
  const assets: Record<string, Blob> = {};
  for (const file of [...rig.layers.map((l) => l.file), "head.regions.png"]) assets[file] = new Blob([file]);
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
    rename: async () => "renamed",
    duplicate: async () => "copy",
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

/** A click on the glass at rig px (x, y): the glass is 640 px square, the rig 64 px. */
async function pickAt(x: number, y: number): Promise<void> {
  const dome = q('[data-callout="eye"]').parentElement?.firstElementChild as HTMLElement;
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 640, height: 640 }));
  await act(async () => {
    dome.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x * 10, clientY: y * 10 }));
  });
  spy.mockRestore();
  await elapse(0);
}

const tab = (name: string): HTMLElement => {
  const found = [...view.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name);
  if (found === undefined) throw new Error(`no tab ${name}`);
  return found;
};

beforeEach(async () => {
  vi.useFakeTimers();
  renders.length = 0;
  lib = library();
  const pixels = fixturePixels(regionRig());
  view = await mount(<Anatomy record={record()} library={lib} readPixels={async (file) => pixels[file]} />);
  await elapse(0);
});

afterEach(async () => {
  await view.unmount();
  restoreMotion();
  vi.useRealTimers();
});

describe("the Mood / Look / Face tabs", () => {
  it("is a tablist: Mood selected first, arrows, Home and End switch and are kept from the shell", async () => {
    expect(q('[role="tablist"]').querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    expect(q("#signal-panel-look").hidden).toBe(true);
    expect(await key(tab("Mood"), "ArrowRight")).toBe(true);
    expect(tab("Look").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Look"));
    expect(q("#signal-panel-look").hidden).toBe(false);
    expect(q("#signal-panel-mood").hidden).toBe(true);
    await key(tab("Look"), "Home");
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    await key(tab("Mood"), "End");
    expect(tab("Face").getAttribute("aria-selected")).toBe("true");
    await key(tab("Face"), "ArrowLeft");
    expect(tab("Look").getAttribute("aria-selected")).toBe("true");
    await key(tab("Look"), "ArrowLeft");
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    expect(tab("Look").tabIndex).toBe(-1);
    // The channel actions stay under both tabs.
    expect(q('[aria-label="Channels from the forge"]').closest('[role="tabpanel"]')).toBeNull();
  });
});

describe("the Palette card", () => {
  it("a region chip opens the ring; a lamp writes look.regions, the reset dot deletes the key", async () => {
    await click(tab("Look"));
    expect(view.container.querySelectorAll('[data-region-layer="head"] [data-chip]')).toHaveLength(2);
    await click(q('[data-chip="region:head/r1"]'));
    const lamps = view.container.querySelectorAll<HTMLButtonElement>("[data-ring] button");
    expect(lamps).toHaveLength(8);
    expect(q('input[type="color"]')).toBeDefined();
    // The region's own paint leads its ring; the next lamp is ember.
    await click(lamps[1] as HTMLButtonElement);
    expect(last().look.regions).toEqual({ "head/r1": "#e0453a" });
    await click(q('[data-reset="head/r1"]'));
    expect(last().look.regions).toBeUndefined();
    expect(view.container.querySelector('[data-reset="head/r1"]')).toBeNull();
  });

  it("the free picker writes the region too, and the look is kept in the library", async () => {
    await click(tab("Look"));
    await click(q('[data-chip="region:head/r2"]'));
    await slide(q<HTMLInputElement>('input[type="color"]'), "#00ff00");
    expect(last().look.regions).toEqual({ "head/r2": "#00ff00" });
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).toMatchObject({ regions: { "head/r2": "#00ff00" } });
  });

  it("the mouth chip says when nothing carries the mouth light", async () => {
    await click(tab("Look"));
    expect(q<HTMLButtonElement>('[data-chip="light:mouth"]').disabled).toBe(true);
    expect(q('[data-card="palette"]').textContent).toContain("no mouth light on this character");
  });
});

describe("the glass pick", () => {
  it("a click on the head's left half selects the head and its first region, switches to Look, outlines it for 1.2 s", async () => {
    await pickAt(20, 30);
    expect(tab("Look").getAttribute("aria-selected")).toBe("true");
    expect(q("[data-shape-part]").textContent).toBe("head");
    expect(q('[data-chip="region:head/r1"]').getAttribute("aria-current")).toBe("true");
    const outline = q("[data-pick-outline]");
    expect(outline.getAttribute("data-pick-outline")).toBe("fade");
    expect(outline.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    expect(outline.querySelector("path")?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    await elapse(OUTLINE_MS);
    expect(view.container.querySelector("[data-pick-outline]")).toBeNull();
  });

  it("the right half picks the second region; a click on the crown still lifts it", async () => {
    await pickAt(44, 30);
    expect(q('[data-chip="region:head/r2"]').getAttribute("aria-current")).toBe("true");
    await pickAt(32, 4);
    expect(last().look.hidden).toEqual(["crown"]);
  });

  it("a click beside the character (the backdrop) picks nothing", async () => {
    await pickAt(2, 2);
    expect(tab("Mood").getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelector("[data-pick-outline]")).toBeNull();
  });

  it("under reduced motion the outline is drawn steady for its time", async () => {
    setMotion("reduced");
    await pickAt(20, 30);
    expect(q("[data-pick-outline]").getAttribute("data-pick-outline")).toBe("steady");
    await elapse(OUTLINE_MS - 1);
    expect(view.container.querySelector("[data-pick-outline]")).not.toBeNull();
    await elapse(1);
    expect(view.container.querySelector("[data-pick-outline]")).toBeNull();
  });
});

describe("the Shape card", () => {
  it("a Layer stack name selects the part; sliders write look.shape within SHAPE_LIMITS; Reset part and Reset all", async () => {
    await click(q('[data-select="crown"]'));
    expect(tab("Look").getAttribute("aria-selected")).toBe("true");
    expect(q("[data-shape-part]").textContent).toBe("crown");
    expect(view.container.querySelectorAll('[data-card="shape"] input[type="range"]')).toHaveLength(6);
    const size = q<HTMLInputElement>('[data-shape="size"]');
    expect([size.min, size.max]).toEqual(SHAPE_LIMITS.size.map(String));
    await slide(size, "1.3");
    expect(last().look.shape?.crown?.size).toBe(1.3);
    expect(size.parentElement?.querySelector("output")?.textContent).toBe("×1.30");
    await slide(q<HTMLInputElement>('[data-shape="rot"]'), "90");
    const rot = last().look.shape?.crown?.rot ?? 0;
    expect(rot).toBeLessThanOrEqual(SHAPE_LIMITS.rot[1]);
    await click(q('[data-select="jaw"]'));
    await slide(q<HTMLInputElement>('[data-shape="dx"]'), "0.1");
    expect(Object.keys(last().look.shape ?? {}).sort()).toEqual(["crown", "jaw"]);
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).toMatchObject({ shape: { crown: { size: 1.3 }, jaw: { dx: 0.1 } } });
    const button = (name: string) => [...view.container.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;
    await click(button("Reset part"));
    expect(Object.keys(last().look.shape ?? {})).toEqual(["crown"]);
    await click(button("Reset all"));
    expect(last().look.shape).toBeUndefined();
    expect(button("Reset all").disabled).toBe(true);
  });
});
