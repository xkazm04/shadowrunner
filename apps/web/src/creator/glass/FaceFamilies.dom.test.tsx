// @vitest-environment happy-dom
// retire-a-face: the Face tab's FACES card, read through what the face (a probe in place of
// <AvatarCanvas>) was given and what the library was asked to keep: six families with their state,
// Retire / Restore writing a saved look.face.expression.faces, a family without a painted face
// disabled with a note, and Show putting the glass (never the saved look) at a family for a moment,
// or as a held still under reduced motion.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook, type LayerPatch, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, restoreMotion, setMotion, type Mounted } from "../../app/testDom";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy, SAVE_DELAY_MS } from "./Anatomy";
import { SHOW_MS } from "./FaceFamilies";

const renders: AvatarCanvasProps[] = [];

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));

const PATCH: LayerPatch = { file: "head.face.png", bbox: [16, 8, 32, 36], mode: "replace" };

/** testRig with painted faces for every family but suspicion. */
function facedRig(): Rig {
  const rig = testRig();
  const variants = { joy: PATCH, showman: PATCH, anger: PATCH, gloom: PATCH, smug: PATCH };
  return { ...rig, layers: rig.layers.map((l) => (l.name === "head" ? { ...l, variants } : l)) };
}

function record(): CharacterRecord {
  const rig = facedRig();
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
const row = (family: string): HTMLElement => q(`[data-family="${family}"]`);
const state = (family: string): string => row(family).querySelector("[data-family-state]")?.textContent ?? "";
const retire = (family: string): HTMLButtonElement => q<HTMLButtonElement>(`[data-retire="${family}"]`);
const show = (family: string): HTMLButtonElement => q<HTMLButtonElement>(`[data-show="${family}"]`);

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function openFace(rec: CharacterRecord = record()): Promise<void> {
  view = await mount(<Anatomy record={rec} library={lib} />);
  await elapse(0);
  const tab = [...view.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === "Face");
  if (tab === undefined) throw new Error("no Face tab");
  await click(tab);
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

describe("the FACES card", () => {
  it("lists the six families, painted or procedural; a family with no painted face is disabled and says so", async () => {
    await openFace();
    expect([...view.container.querySelectorAll("[data-family]")].map((r) => r.getAttribute("data-family"))).toEqual(["joy", "showman", "anger", "gloom", "smug", "suspicion"]);
    expect(["joy", "showman", "anger", "gloom", "smug"].map(state)).toEqual(Array(5).fill("Painted"));
    expect(state("suspicion")).toBe("Procedural");
    expect(retire("suspicion").disabled).toBe(true);
    expect(retire("joy").disabled).toBe(false);
    expect(retire("joy").getAttribute("aria-label")).toBe("Retire the joy face");
    expect(q("[data-families-note]").textContent).toBe("No painted face for suspicion: this character shows that mood by procedural motion only.");
    expect(q("[data-families-state]").textContent).toBe("Every painted face is on.");
  });

  it("Retire writes look.face.expression.faces live and keeps it; Restore takes it back out", async () => {
    await openFace();
    await click(retire("showman"));
    expect(state("showman")).toBe("Procedural");
    expect(retire("showman").textContent).toBe("Restore");
    expect(retire("showman").getAttribute("aria-label")).toBe("Restore the showman face");
    expect(last().look.face).toEqual({ expression: { faces: { showman: "procedural" } } });
    expect(q("[data-families-state]").textContent).toBe("1 painted face retired to procedural motion.");
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).toMatchObject({ face: { expression: { faces: { showman: "procedural" } } } });
    // The sliders' reset keeps the verdict.
    expect(q<HTMLButtonElement>("[data-face-reset]").disabled).toBe(true);
    await click(retire("showman"));
    expect(state("showman")).toBe("Painted");
    expect(last().look.face).toBeUndefined();
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved.at(-1)).not.toHaveProperty("face");
  });

  it("Retire and Show are keyboard buttons (native buttons, in tab order)", async () => {
    await openFace();
    for (const family of ["joy", "suspicion"]) {
      expect(retire(family).tagName).toBe("BUTTON");
      expect(show(family).tabIndex).not.toBe(-1);
    }
    retire("gloom").focus();
    expect(document.activeElement).toBe(retire("gloom"));
  });

  it("Show puts the glass at the family's strongest emotion for SHOW_MS, never the saved look", async () => {
    await openFace();
    await click(show("showman"));
    expect(show("showman").getAttribute("aria-pressed")).toBe("true");
    expect(last().look.emotion).toBe("theatrical");
    expect(q("[data-motion-state]").textContent).toBe("Showing showman");
    await elapse(SAVE_DELAY_MS);
    expect(lib.saved).toEqual([]);
    await elapse(SHOW_MS);
    expect(last().look.emotion).toBe("neutral");
    expect(show("showman").getAttribute("aria-pressed")).toBe("false");
    // Pressing it again while showing stops it.
    await click(show("anger"));
    expect(last().look.emotion).toBe("furious");
    await click(show("anger"));
    expect(last().look.emotion).toBe("neutral");
  });

  it("under reduced motion Show is a held still: no timed change, pressed again to end", async () => {
    setMotion("reduced");
    await openFace();
    await click(show("joy"));
    expect(last().look.emotion).toBe("delighted");
    await elapse(SHOW_MS * 3);
    expect(last().look.emotion).toBe("delighted");
    expect(q("[data-families-state]").textContent).toContain("Show holds a still until you press it again.");
    await click(show("joy"));
    expect(last().look.emotion).toBe("neutral");
  });
});

// forge-creator S1: a family with no painted face says why when the record carries the forge's reading.
describe("why a face was refused", () => {
  /** testRig with painted faces for joy and showman only. */
  function twoFaced(): CharacterRecord {
    const base = record();
    const variants = { joy: PATCH, showman: PATCH };
    return { ...base, rig: { ...base.rig, layers: base.rig.layers.map((l) => (l.name === "head" ? { ...l, variants } : l)) } };
  }

  it("names the reason with its number for each family that has a reading, the general note for the rest", async () => {
    await openFace({
      ...twoFaced(),
      faceGate: { anger: { reason: "iris", irisDriftPx: 7.2, limit: 4, attempts: 3 }, gloom: { reason: "budget" }, smug: { reason: "band", outsideBandMean: 9.4, limit: 7.6, attempts: 1 } },
    });
    const why = (family: string): string => row(family).querySelector("[data-family-why]")?.textContent ?? "";
    expect(why("anger")).toBe("Not painted: the eyes moved 7.2 px (limit 4), 3 tries.");
    expect(why("gloom")).toBe("Not painted: the daily budget ran out.");
    expect(why("smug")).toBe("Not painted: it repainted outside the brows (change 9.4, limit 7.6).");
    expect(state("anger")).toBe("Procedural");
    expect(row("suspicion").querySelector("[data-family-why]")).toBeNull();
    expect(row("joy").querySelector("[data-family-why]")).toBeNull();
    expect(q("[data-families-note]").textContent).toBe("No painted face for suspicion: this character shows that mood by procedural motion only.");
  });

  it("a record without readings shows the existing copy; a reading for a painted family is not shown", async () => {
    await openFace({ ...record(), faceGate: { joy: { reason: "no_change" } } });
    expect(view.container.querySelector("[data-family-why]")).toBeNull();
    expect(q("[data-families-note]").textContent).toBe("No painted face for suspicion: this character shows that mood by procedural motion only.");
  });
});
