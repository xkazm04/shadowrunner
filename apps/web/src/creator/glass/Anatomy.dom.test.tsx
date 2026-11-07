// @vitest-environment happy-dom
// Costume 3.1: Anatomy Under Glass drives the face. <AvatarCanvas> is replaced by a probe that keeps
// every props object it renders with, so the tests read what the face was given: lamps in the ring
// write Look.palette, rail lamps and a click on the crown write Look.hidden, the knob writes
// Look.emotion, gestures pulse, and the look is kept in the library once after the last change.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import { ringOf } from "./swatches";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

function record(): CharacterRecord {
  const rig = testRig();
  return { id: rig.id, rig, assets: {}, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
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

function named(name: string): HTMLElement {
  const found = [...view.container.querySelectorAll<HTMLElement>("button,[role=slider]")].find(
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

async function key(el: Element, k: string): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(async () => {
  vi.useFakeTimers();
  renders.length = 0;
  lib = library();
  view = await mount(<Anatomy record={record()} library={lib} />);
  await elapse(0);
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("the pinned lights", () => {
  it("pins a label per light, and a label opens a ring of eight lamps", async () => {
    const callouts = view.container.querySelectorAll("[data-callout]");
    expect([...callouts].map((c) => c.getAttribute("data-callout")).sort()).toEqual(["eye", "glow", "mouth", "rim"]);
    await click(view.container.querySelector('[data-callout="eye"]') as Element);
    expect(view.container.querySelectorAll("[data-ring] button")).toHaveLength(8);
    expect(view.container.querySelector('[data-callout="eye"]')?.getAttribute("aria-expanded")).toBe("true");
  });

  it("a lamp writes Look.palette and the face re-renders with it", async () => {
    await click(view.container.querySelector('[data-callout="eye"]') as Element);
    const lamp = ringOf("eye", testRig().palette.eye)[3] ?? "";
    await click(view.container.querySelector(`[data-ring] button:nth-of-type(4)`) as Element);
    expect(last().look.palette.eye).toBe(lamp);
  });

  it("Esc closes the ring and is kept from the shell", async () => {
    await click(view.container.querySelector('[data-callout="glow"]') as Element);
    const ring = view.container.querySelector("[data-ring]") as Element;
    expect(await key(ring, "Escape")).toBe(true);
    expect(view.container.querySelector("[data-ring]")).toBeNull();
  });
});

describe("the layer stack", () => {
  it("lists every layer front-most first, and a lamp writes Look.hidden", async () => {
    const rows = [...view.container.querySelectorAll("[data-layer]")].map((r) => r.getAttribute("data-layer"));
    expect(rows[0]).toBe("monocle");
    expect(rows.at(-1)).toBe("background");
    await click(named("crown on the face"));
    expect(last().look.hidden).toEqual(["crown"]);
    expect(named("crown on the face").getAttribute("aria-pressed")).toBe("false");
  });

  it("focus on a row's lamp outlines that layer over the glass", async () => {
    await act(async () => named("jaw on the face").focus());
    expect(view.container.innerHTML).toMatch(/inset-inline-start: 37\.5%/);
  });

  it("a click on the crown lifts it off", async () => {
    const dome = view.container.querySelector("[data-callout]")?.parentElement?.firstElementChild as HTMLElement;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 640, height: 640 }));
    await act(async () => {
      dome.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 320, clientY: 30 }));
    });
    spy.mockRestore();
    expect(last().look.hidden).toEqual(["crown"]);
  });

  it("keeps the look in the library shortly after the last change, once", async () => {
    await click(named("eye_l on the face"));
    await click(named("eye_r on the face"));
    expect(lib.saved).toHaveLength(0);
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved).toHaveLength(1);
  });

  it("reset look restores defaultLook(rig)", async () => {
    await click(named("crown on the face"));
    await click(named("Reset look"));
    expect(last().look).toEqual(defaultLook(testRig()));
  });
});

describe("mood, gestures, voice", () => {
  it("arrow keys on the knob write Look.emotion and play its gesture; the shell never hears them", async () => {
    const knob = named("Expression");
    expect(await key(knob, "ArrowRight")).toBe(true);
    await elapse(0);
    expect(last().look.emotion).toBe("amused");
    expect(renders.some((r) => r.gesture === "tilt")).toBe(true);
    expect(knob.getAttribute("aria-valuetext")).toBe("amused");
    await key(knob, "ArrowLeft");
    await key(knob, "ArrowLeft");
    expect(last().look.emotion).toBe("theatrical");
  });

  it("a gesture fires once per press, also the same one twice", async () => {
    await click(named("nod"));
    await elapse(0);
    expect(last().gesture).toBe("nod");
    await elapse(200);
    expect(last().gesture).toBeUndefined();
    await click(named("nod"));
    await elapse(0);
    expect(last().gesture).toBe("nod");
  });

  it("every control is a native button, input or slider with an accessible name", () => {
    const controls = view.container.querySelectorAll("button,input,[role=slider],a");
    expect(controls.length).toBeGreaterThan(20);
    for (const c of controls) {
      const name = c.getAttribute("aria-label") ?? c.textContent?.trim() ?? "";
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("C4: the character sheet", () => {
  it("is shown under VOICE for a record with a sheet, and absent without one", async () => {
    expect(view.container.querySelector("[data-sheet]")).toBeNull();
    await view.unmount();
    const sheet = { archetype: "Drowned diver", hook: "Hums shanties between lines.", lines: ["Forty fathoms of chat.", "Bubbles mean I laugh."] };
    view = await mount(<Anatomy record={{ ...record(), sheet }} library={lib} />);
    await elapse(0);
    const card = view.container.querySelector("[data-sheet]");
    expect(card?.textContent).toContain("Drowned diver");
    expect(card?.textContent).toContain("Hums shanties between lines.");
    expect([...(card?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual(sheet.lines);
  });
});
