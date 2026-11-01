// @vitest-environment happy-dom
// Task 4.3: the customize panel drives the stage. <AvatarCanvas> is replaced by a probe that keeps
// every props object it renders with, so the tests read what the face was given.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, type Gesture } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import { useState } from "react";
import { Workbench, type Tab } from "../Workbench";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";

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

function Bench({ library }: { library: Library }) {
  const [tab, setTab] = useState<Tab>("looks");
  return <Workbench record={record()} library={library} tab={tab} onTab={setTab} />;
}

const last = (): AvatarCanvasProps => {
  const props = renders.at(-1);
  if (props === undefined) throw new Error("the stage never rendered a face");
  return props;
};

function button(view: Mounted, name: string): HTMLButtonElement {
  const found = [...view.container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

let view: Mounted;
let lib: ReturnType<typeof library>;

beforeEach(async () => {
  vi.useFakeTimers();
  renders.length = 0;
  lib = library();
  view = await mount(<Bench library={lib} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("customize -> stage", () => {
  it("a palette change re-renders the stage with the new look", async () => {
    expect(last().look.palette.eye).toBe("#445566");
    await click(button(view, "Eye light: violet"));
    expect(last().look.palette.eye).toBe("#9a5cf0");
    expect(button(view, "Eye light: violet").getAttribute("aria-pressed")).toBe("true");
  });

  it("the colour picker writes any colour", async () => {
    const picker = view.container.querySelector<HTMLInputElement>('input[aria-label="Glow: any colour"]');
    if (picker === null) throw new Error("no picker");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(picker, "#abcdef");
      picker.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(last().look.palette.glow).toBe("#abcdef");
  });

  it("offers one toggle per accessory, crown and eye layer, and a toggle writes look.hidden", async () => {
    const names = [...view.container.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(["Monocle", "Crown", "Left eye", "Right eye"]));
    expect(names).not.toContain("Jaw");
    await click(button(view, "Monocle"));
    expect(last().look.hidden).toEqual(["monocle"]);
    expect(button(view, "Monocle").getAttribute("aria-pressed")).toBe("false");
    await click(button(view, "Monocle"));
    expect(last().look.hidden).toEqual([]);
  });

  it("keeps the look in the library shortly after the last change, once", async () => {
    await click(button(view, "Monocle"));
    await click(button(view, "Left eye"));
    expect(lib.saved).toHaveLength(0);
    await elapse(500);
    expect(lib.saved).toEqual([expect.objectContaining({ hidden: ["eye_l", "monocle"] })]);
  });

  it("reset look restores defaultLook(rig)", async () => {
    await click(button(view, "Monocle"));
    await click(button(view, "Eye light: violet"));
    await click(button(view, "Reset look"));
    expect(last().look).toEqual(defaultLook(testRig()));
  });
});

describe("face", () => {
  const gestureEdges = (): Gesture[] => {
    const edges: Gesture[] = [];
    let prev: Gesture | undefined;
    for (const r of renders) {
      if (r.gesture !== undefined && r.gesture !== prev) edges.push(r.gesture);
      prev = r.gesture;
    }
    return edges;
  };

  beforeEach(async () => {
    await click(button(view, "FACE"));
  });

  it("offers ten emotions and six gestures", () => {
    expect(view.container.querySelectorAll('[aria-label="Expression"] button')).toHaveLength(10);
    expect(view.container.querySelectorAll('[aria-label="Gesture"] button')).toHaveLength(6);
  });

  it("an emotion writes look.emotion and plays its gesture", async () => {
    await click(button(view, "furious"));
    await elapse(10);
    expect(last().look.emotion).toBe("furious");
    expect(gestureEdges()).toEqual(["flare"]);
  });

  it("the gesture prop fires once per press, also for the same gesture twice", async () => {
    // One tick for the pulse to start, then past its end (separate acts, as separate frames).
    for (const g of ["nod", "nod", "glare"]) {
      await click(button(view, g));
      await elapse(1);
      await elapse(300);
    }
    expect(gestureEdges()).toEqual(["nod", "nod", "glare"]);
    expect(last().gesture).toBeUndefined();
  });

  it("a press during a pulse still plays once", async () => {
    await click(button(view, "tilt"));
    await elapse(5);
    await click(button(view, "tilt"));
    await elapse(1);
    await elapse(300);
    expect(gestureEdges()).toEqual(["tilt", "tilt"]);
  });
});

describe("accessibility", () => {
  it("every control is a native button or input with an accessible name", () => {
    for (const el of view.container.querySelectorAll("button, input")) {
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
      expect(name.length, el.outerHTML).toBeGreaterThan(0);
    }
  });
});
