// @vitest-environment happy-dom
// /studio (spec avatar-reach, requirements 4.1-4.4): the first cast pack is on stage with no keys,
// replay offers recorded lines (or says there are none), live offers a 300-character box, and a
// browser without MediaRecorder / captureStream is told so instead of offered Record. The player
// and the pack loader are probes.
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plane } from "../../app/plane";
import { mount, type Mounted } from "../../app/testDom";
import { testRig } from "../../creator/testFixtures";
import type { PlayableSource } from "../playable";

const probe = vi.hoisted(() => ({ voice: "clerk", id: "malakor", loads: [] as unknown[], players: 0, disposed: 0 }));

vi.mock(import("@sr/avatar/core"), async (original) => ({
  ...(await original()),
  createAvatarPlayer: () => {
    probe.players += 1;
    const noop = () => undefined;
    return {
      setLook: noop,
      setEmotion: noop,
      gesture: noop,
      attachAudio: noop,
      setLevel: noop,
      resize: noop,
      start: noop,
      stop: noop,
      renderFrame: noop,
      dispose: () => {
        probe.disposed += 1;
      },
    };
  },
}));

vi.mock(import("../playable"), async (original) => ({
  ...(await original()),
  loadCastIndex: async () => [{ id: "replay-the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 10 }],
  loadPlayable: async (source: PlayableSource) => {
    probe.loads.push(source);
    const rig = testRig(probe.id, "The Tallyman");
    return { ok: true as const, playable: { id: probe.id, name: rig.name, rig, look: defaultLook(rig), voice: probe.voice as "clerk", assets: {} } };
  },
}));

vi.mock(import("../../creator/library/libraryStore"), async (original) => {
  const actual = await original();
  return { ...actual, openLibrary: async () => actual.memoryLibrary() };
});

const { default: StudioPage, NO_RECORDER } = await import("./StudioPage");

let m: Mounted | undefined;

/** Sets a controlled input's value the way React hears it (the native setter, then `input`). */
async function background(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function open(plane: Plane): Promise<HTMLElement> {
  m = await mount(<StudioPage plane={plane} />);
  for (let i = 0; i < 10; i += 1) await m.rerender(<StudioPage plane={plane} />);
  return m.container;
}

const recorderGlobals = () => {
  vi.stubGlobal("MediaRecorder", Object.assign(function MediaRecorder() {}, { isTypeSupported: (t: string) => t === "video/webm" }));
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", { value: () => undefined, configurable: true });
};

beforeEach(() => {
  probe.voice = "clerk";
  probe.id = "replay-the-tallyman";
  probe.loads = [];
  probe.players = 0;
  probe.disposed = 0;
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "captureStream");
});

describe("StudioPage", () => {
  it("puts the first cast pack on stage with a one-line script of a recorded line on replay", async () => {
    recorderGlobals();
    const c = await open("replay");
    expect(probe.loads).toEqual([{ pack: "/packs/the-tallyman.srpack" }]);
    expect(probe.players).toBe(1);
    const rows = c.querySelectorAll('[aria-label="Script"] li');
    expect(rows.length).toBe(1);
    const clip = c.querySelector<HTMLSelectElement>('select[data-script="clip"]');
    expect(clip?.options.length).toBeGreaterThan(1);
    // Malakor's first standalone line was recorded "theatrical" with a "flare".
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Line 1 mood"]')?.value).toBe("theatrical");
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Line 1 gesture"]')?.value).toBe("flare");
    expect(c.querySelector('[data-studio="borrowed"]')?.textContent).toContain("Malakor");
    expect(c.querySelector("textarea")).toBeNull();
    const preview = [...c.querySelectorAll("button")].find((b) => b.textContent === "Preview");
    expect(preview?.disabled).toBe(false);
    expect(c.querySelector('[data-studio="record"]')).not.toBeNull();
    expect(c.querySelector('[data-studio="no-recorder"]')).toBeNull();
  });

  it("edits the script: add up to eight, override a mood, move with the focus kept, remove", async () => {
    const c = await open("replay");
    const button = (name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    const add = c.querySelector<HTMLButtonElement>('button[data-script="add"]');
    for (let i = 0; i < 9; i += 1) await act(async () => add?.click());
    expect(c.querySelectorAll('[aria-label="Script"] li').length).toBe(8);
    expect(add?.disabled).toBe(true);
    expect(c.textContent).toContain("Up to 8 lines and 120 s a take");
    const clips = [...c.querySelectorAll<HTMLSelectElement>('select[data-script="clip"]')].map((s) => s.value);
    expect(new Set(clips).size).toBe(8);

    const mood = c.querySelector<HTMLSelectElement>('select[aria-label="Line 2 mood"]');
    await act(async () => {
      if (mood !== null) mood.value = "furious";
      mood?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Line 2 mood"]')?.value).toBe("furious");

    await act(async () => button("Move line 2 up")?.click());
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Line 1 mood"]')?.value).toBe("furious");
    expect([...c.querySelectorAll<HTMLSelectElement>('select[data-script="clip"]')].map((s) => s.value).slice(0, 2)).toEqual([clips[1], clips[0]]);
    // At the top "up" is disabled, so the focus goes to the line's "down".
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move line 1 down");
    expect(button("Move line 1 up")?.disabled).toBe(true);

    await act(async () => button("Remove line 1")?.click());
    expect(c.querySelectorAll('[aria-label="Script"] li').length).toBe(7);
    expect(c.querySelector<HTMLSelectElement>('select[data-script="clip"]')?.value).toBe(clips[0]);
  });

  it("offers the video sizes (as shown first) and a transparent background with its note", async () => {
    const c = await open("replay");
    const sizes = [...c.querySelectorAll<HTMLInputElement>('input[name="studio-aspect"]')];
    expect(sizes.map((s) => s.value)).toEqual(["shown", "square", "portrait", "landscape"]);
    expect(sizes[0]?.checked).toBe(true);
    expect(c.querySelector('[data-studio="alpha-note"]')).toBeNull();
    await act(async () => c.querySelector<HTMLButtonElement>('[data-studio="transparent"]')?.click());
    expect(c.querySelector('[data-studio="alpha-note"]')?.textContent).toContain("Safari");
    expect(c.querySelector<HTMLElement>('[data-studio="stage"]')?.style.background).toBe("");
  });

  it("says so when the character has no recorded lines", async () => {
    probe.voice = "velvet";
    probe.id = "replay-auntie-asp";
    const c = await open("replay");
    expect(c.querySelector('[data-studio="no-lines"]')?.textContent).toContain("no recorded lines");
    const preview = [...c.querySelectorAll("button")].find((b) => b.textContent === "Preview");
    expect(preview?.disabled).toBe(true);
  });

  it("offers a 300-character box on live", async () => {
    const c = await open("live");
    const box = c.querySelector("textarea");
    expect(box?.maxLength).toBe(300);
    expect(c.querySelector('[aria-label="Recorded lines"]')).toBeNull();
  });

  it("says the browser cannot record instead of offering Record", async () => {
    const c = await open("replay");
    expect(c.querySelector('[data-studio="record"]')).toBeNull();
    expect(c.querySelector('[data-studio="no-recorder"]')?.textContent).toBe(NO_RECORDER);
  });

  it("paints the stage in the picked background and disposes the player on leave", async () => {
    const c = await open("replay");
    const input = c.querySelector<HTMLInputElement>('input[type="color"]');
    expect(input).not.toBeNull();
    await background(input as HTMLInputElement, "#336699");
    expect(c.querySelector<HTMLElement>('[data-studio="stage"]')?.style.background).toMatch(/#336699|rgb\(51, 102, 153\)/);
    await m?.unmount();
    m = undefined;
    expect(probe.disposed).toBe(1);
  });
});
