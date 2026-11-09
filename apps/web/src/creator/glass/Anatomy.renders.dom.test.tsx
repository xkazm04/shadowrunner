// @vitest-environment happy-dom
// perfection-pass task 9 (requirement 9.2): a slider drag re-renders only the dragged control and
// the cards that read the changed slice. The editor runs on the real library hook over the memory
// store (so a look save patches the record as in the app); render counts come from renderCount.ts,
// which must load before react-dom.
import "./renderCount";
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import { memoryLibrary, type CharacterRecord } from "../library/libraryStore";
import { useLibrary } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import { forgetHistories } from "./useLookHistory";
import { renders, resetRenders } from "./renderCount";

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-emotion={props.look.emotion} />,
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

const STEPS = 30;

function record(): CharacterRecord {
  const rig = testRig();
  const assets = Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.name], { type: "image/png" })]));
  return { id: rig.id, rig, assets, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

function Editor() {
  const library = useLibrary({
    open: async () => {
      const store = memoryLibrary();
      await store.put(record());
      return store;
    },
    cast: async () => [],
  });
  return library.active === undefined ? null : <Anatomy record={library.active} library={library} />;
}

let view: Mounted;
const q = <T extends Element>(selector: string): T => {
  const found = view.container.querySelector<T>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
};

async function slide(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** STEPS slider moves from `from` by `step`, then the pointer lifts; the counts of the drag alone. */
async function drag(el: HTMLInputElement, from: number, step: number): Promise<Readonly<Record<string, number>>> {
  resetRenders();
  for (let i = 1; i <= STEPS; i += 1) await slide(el, String(from + i * step));
  const counted = renders();
  await act(async () => {
    window.dispatchEvent(new Event("pointerup"));
  });
  return counted;
}

beforeEach(async () => {
  vi.useFakeTimers();
  forgetHistories();
  view = await mount(<Editor />);
  await elapse(0);
  await elapse(0);
  await act(async () => q<HTMLButtonElement>('[data-select="head"]').click());
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

/** Every card of the editor (the glass, the tab strip and Anatomy itself render on any look change). */
const CARDS = ["LayerRail", "NameField", "HistoryBar", "MoodDial", "GestureCard", "ActsCard", "VoiceCard", "PaletteCard", "ShapeCard", "FaceCard", "FaceFamilies", "ChannelActions"] as const;
const cards = (counts: Readonly<Record<string, number>>, own: Partial<Record<(typeof CARDS)[number], number>>): void =>
  expect(Object.fromEntries(CARDS.map((c) => [c, counts[c] ?? 0]))).toEqual(Object.fromEntries(CARDS.map((c) => [c, own[c] ?? 0])));

describe("a slider drag re-renders the dragged card only", () => {
  it("a shape slider: the Shape card each step (and the history bar once, when Undo lights)", async () => {
    const counts = await drag(q('[data-shape="size"]'), 1, 0.01);
    cards(counts, { ShapeCard: STEPS, HistoryBar: 1 });
    expect(counts.Glass).toBe(STEPS);
  });

  it("a face slider: the Face card each step; FACES (retired faces only) is skipped", async () => {
    const counts = await drag(q('[data-face="gaze.range"]'), 0.1, 0.01);
    cards(counts, { FaceCard: STEPS, HistoryBar: 1 });
    expect(counts.Glass).toBe(STEPS);
  });

  it("a colour picker: the Palette card each step", async () => {
    await act(async () => q<HTMLButtonElement>('[data-chip="light:eye"]').click());
    resetRenders();
    const picker = q<HTMLInputElement>('input[type="color"]');
    for (let i = 1; i <= STEPS; i += 1) await slide(picker, `#${(16 + i).toString(16).padStart(2, "0")}2040`);
    cards(renders(), { PaletteCard: STEPS, HistoryBar: 1 });
  });

  it("the save after a drag patches the record: only the card that reads the record renders", async () => {
    await drag(q('[data-shape="size"]'), 1, 0.01);
    resetRenders();
    await elapse(SAVE_DELAY_MS + 50);
    expect(renders().Editor).toBe(1);
    cards(renders(), { ChannelActions: 1 });
  });
});
