// @vitest-environment happy-dom
// tiger L1: the creator rehearses a signature act. A forged character whose rig carries `Layer.act`
// shows SIGNATURE ACTS under GESTURE, one line per act; Rehearse plays that layer's act on the glass
// (a new `act.n` each press, so a repeat plays again). A recorded cast character (Lot Ninety) gets
// the act compiled from its recorded brief; a character with no act shows no card.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, validateRig, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lotNinetyJob from "../../../../../assets/replay/forge/lot-ninety/job.json";
import { elapse, mount, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy } from "./Anatomy";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

const recordOf = (id: string, rig: Rig): CharacterRecord => ({ id, rig, assets: {}, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-08T00:00:00.000Z" });

function acted(): Rig {
  const rig = testRig("forged-bell", "Bell");
  return { ...rig, layers: rig.layers.map((l) => (l.name === "monocle" ? { ...l, act: { cue: ["ring"] } } : l)) };
}

const library = (): Library => ({
  status: "ready",
  persistent: true,
  entries: [],
  select: () => undefined,
  add: async () => undefined,
  remove: async () => "refused",
  saveLook: async () => undefined,
  saveVoice: async () => undefined,
});

let view: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  renders.length = 0;
});

afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

const card = () => view?.container.querySelector("[data-acts]");
const rehearse = (part: string) => view?.container.querySelector<HTMLButtonElement>(`button[aria-label="Rehearse the ${part} act"]`);

describe("Rehearse a signature act", () => {
  it("lists the act and plays it on the glass, once per press", async () => {
    view = await mount(<Anatomy record={recordOf("forged-bell", acted())} library={library()} />);
    await elapse(0);
    expect(card()?.textContent).toContain('monocle: on "ring"');
    expect(renders.at(-1)?.act).toBeUndefined();
    await act(async () => rehearse("monocle")?.click());
    expect(renders.at(-1)?.act).toEqual({ layer: "monocle", n: 1 });
    await act(async () => rehearse("monocle")?.click());
    expect(renders.at(-1)?.act).toEqual({ layer: "monocle", n: 2 });
  });

  it("a recorded cast character rehearses the act compiled from its recorded brief", async () => {
    const read = validateRig(lotNinetyJob.rig);
    if (!read.ok) throw new Error("lot-ninety rig does not validate");
    view = await mount(<Anatomy record={recordOf("replay-lot-ninety", read.value)} library={library()} />);
    await elapse(0);
    expect(card()?.textContent).toContain('hand r: on "sold"');
    await act(async () => rehearse("hand r")?.click());
    expect(renders.at(-1)?.act).toEqual({ layer: "hand_r", n: 1 });
    expect(renders.at(-1)?.rig.layers.find((l) => l.name === "hand_r")?.act).toEqual({ cue: ["sold"] });
  });

  it("shows no card for a character without an act", async () => {
    view = await mount(<Anatomy record={recordOf("plain", testRig("plain"))} library={library()} />);
    await elapse(0);
    expect(card()).toBeNull();
  });
});
