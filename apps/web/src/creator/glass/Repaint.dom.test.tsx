// @vitest-environment happy-dom
// forge-creator S2, repaint one face: the Face tab's Repaint, read through what the face (a probe in
// place of <AvatarCanvas>) was given, what the repaint client was asked and what the library was
// asked to keep. The estimate is shown before anything is spent; the eyes line is prefilled from the
// record's source; the candidate is compared on the glass; Accept keeps only that family's face,
// Decline keeps the record as it was; a refused candidate cannot be accepted; an expired source is
// disabled and says so; a character with no source (recorded, imported) has no Repaint at all.
import type { AvatarCanvasProps } from "@sr/avatar";
import type { RepaintCandidate, RepaintRequest } from "@sr/forge/wire";
import { defaultLook, type LayerPatch, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import { onlyFamilyChanged } from "../forge/faces";
import type { CharacterRecord } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { testRig } from "../testFixtures";
import { Anatomy } from "./Anatomy";
import { EXPIRED_NOTE } from "./RepaintPanel";

const renders: AvatarCanvasProps[] = [];
const asked: { jobId: string; request: RepaintRequest }[] = [];
const answer: { next: () => Promise<RepaintCandidate> } = { next: async () => good() };

vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));
vi.mock(import("../forge/repaintClient"), async (original) => ({
  ...(await original()),
  repaintFace: async (jobId: string, request: RepaintRequest) => {
    asked.push({ jobId, request });
    return answer.next();
  },
}));

const PATCH: LayerPatch = { file: "head.joy.png", bbox: [16, 8, 32, 36], mode: "replace" };
const NEW: LayerPatch = { file: "head.joy_r1.png", bbox: [18, 10, 20, 12], mode: "over" };
const JOB = "a".repeat(32);

function good(): RepaintCandidate {
  return { family: "joy", ok: true, plane: "live", patch: { layers: { head: NEW }, assets: { "head.joy_r1.png": "data:image/png;base64,AAAA" } }, left: { family: 1, job: 3 } };
}

function record(source: CharacterRecord["source"] = { jobId: JOB, expiresAt: Date.now() + 3_600_000, eyes: "carved holes lit from inside" }): CharacterRecord {
  const base = testRig();
  const rig: Rig = { ...base, layers: base.layers.map((l) => (l.name === "head" ? { ...l, variants: { joy: PATCH, anger: { ...PATCH, file: "head.anger.png" } } } : l)) };
  const assets: Record<string, Blob> = {};
  for (const l of rig.layers) assets[l.file] = new Blob([l.file]);
  assets["head.joy.png"] = new Blob(["joy"]);
  assets["head.anger.png"] = new Blob(["anger"]);
  return { id: rig.id, rig, assets, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-08T00:00:00.000Z", faceGate: { gloom: { reason: "iris" } }, ...(source === undefined ? {} : { source }) };
}

function library(): Library & { added: CharacterRecord[] } {
  const added: CharacterRecord[] = [];
  return {
    added,
    status: "ready",
    persistent: true,
    entries: [],
    select: () => undefined,
    add: async (r) => {
      added.push(r);
    },
    remove: async () => "refused",
    saveLook: async () => undefined,
    saveVoice: async () => undefined,
    rename: async () => "renamed",
    duplicate: async () => "copy",
  };
}

let view: Mounted;
let lib: ReturnType<typeof library>;
const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = view.container.querySelector<T>(sel);
  if (el === null) throw new Error(`nothing matches ${sel}`);
  return el;
};
const last = (): AvatarCanvasProps => {
  const props = renders.at(-1);
  if (props === undefined) throw new Error("no face");
  return props;
};
async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await elapse(0);
}

async function openFace(rec: CharacterRecord): Promise<void> {
  view = await mount(<Anatomy record={rec} library={lib} />);
  await elapse(0);
  const tab = [...view.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === "Face");
  if (tab === undefined) throw new Error("no Face tab");
  await click(tab);
}

beforeEach(() => {
  vi.useFakeTimers();
  renders.length = 0;
  asked.length = 0;
  answer.next = async () => good();
  lib = library();
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("Repaint one face", () => {
  it("shows the estimate and the prefilled eyes line before spending; the request carries them and the hint", async () => {
    await openFace(record());
    await click(q('[data-repaint-family="joy"]'));
    expect(asked).toEqual([]);
    expect(q("[data-repaint-estimate]").textContent).toContain("$0.14");
    expect(q<HTMLInputElement>("[data-repaint-eyes]").value).toBe("carved holes lit from inside");
    await click(q("[data-repaint-subtle]"));
    expect(q("[data-repaint-subtle]").getAttribute("aria-pressed")).toBe("true");
    await click(q("[data-repaint-go]"));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.jobId).toBe(JOB);
    expect(asked[0]?.request).toMatchObject({ family: "joy", eyes: "carved holes lit from inside", hint: "too_subtle" });
    expect(asked[0]?.request.key).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
  });

  it("while it paints, a calm status; then the candidate is compared on the glass; Accept keeps only that family's face", async () => {
    let release: () => void = () => undefined;
    answer.next = () => new Promise((resolve) => (release = () => resolve(good())));
    const rec = record();
    await openFace(rec);
    await click(q('[data-repaint-family="joy"]'));
    await click(q("[data-repaint-go]"));
    expect(q("[data-repaint-status]").textContent).toBe("Repainting the joy face. One edit; it can take up to a minute.");
    expect(q<HTMLButtonElement>('[data-repaint-family="anger"]').disabled).toBe(true);
    await act(async () => release());
    await elapse(0);
    expect(q("[data-repaint]").getAttribute("data-repaint")).toBe("candidate");
    expect(last().look.emotion).toBe("delighted");
    expect(last().rig.layers.find((l) => l.name === "head")?.variants?.joy).toEqual(NEW);
    await click(q('[data-repaint-show="current"]'));
    expect(last().rig.layers.find((l) => l.name === "head")?.variants?.joy).toEqual(PATCH);
    expect(lib.added).toEqual([]);
    await click(q("[data-repaint-accept]"));
    expect(lib.added).toHaveLength(1);
    const kept = lib.added[0] as CharacterRecord;
    expect(onlyFamilyChanged(rec.rig, kept.rig, "joy")).toBe(true);
    expect(kept.rig.layers.find((l) => l.name === "head")?.variants).toEqual({ joy: NEW, anger: { ...PATCH, file: "head.anger.png" } });
    for (const l of rec.rig.layers) expect(kept.assets[l.file]).toBe(rec.assets[l.file]);
    expect(kept.assets["head.anger.png"]).toBe(rec.assets["head.anger.png"]);
    expect(kept.assets["head.joy_r1.png"]).toBeInstanceOf(Blob);
    expect(kept.assets["head.joy.png"]).toBeUndefined();
    expect([kept.voice, kept.source, kept.faceGate]).toEqual([rec.voice, rec.source, rec.faceGate]);
    expect(view.container.querySelector("[data-repaint]")).toBeNull();
  });

  it("Decline keeps the record byte-identical and asks the library nothing", async () => {
    const rec = record();
    const before = JSON.stringify(rec);
    await openFace(rec);
    await click(q('[data-repaint-family="joy"]'));
    await click(q("[data-repaint-go]"));
    await click(q("[data-repaint-decline]"));
    expect(lib.added).toEqual([]);
    expect(JSON.stringify(rec)).toBe(before);
    expect(last().rig).toBe(rec.rig);
  });

  it("a candidate the gate refused says why and cannot be accepted", async () => {
    answer.next = async () => ({ family: "joy", ok: false, plane: "live", gate: { reason: "iris", irisDriftPx: 6.1, limit: 4 }, left: { family: 0, job: 2 } });
    await openFace(record());
    await click(q('[data-repaint-family="joy"]'));
    await click(q("[data-repaint-go]"));
    expect(q("[data-repaint-status]").textContent).toBe("The new face did not pass: the eyes moved 6.1 px (limit 4). Nothing was changed. No repaints left for this face.");
    expect(view.container.querySelector("[data-repaint-accept]")).toBeNull();
    expect(lib.added).toEqual([]);
  });

  it("an expired source shows Repaint disabled with the 24 h note; no source shows no Repaint", async () => {
    await openFace(record({ jobId: JOB, expiresAt: Date.now() - 1 }));
    const key = q<HTMLButtonElement>('[data-repaint-family="joy"]');
    expect(key.disabled).toBe(true);
    expect(key.getAttribute("aria-describedby")).toBe("face-families-expired");
    expect(q("[data-repaint-expired]").textContent).toBe(EXPIRED_NOTE);
    await view.unmount();
    const imported = record();
    delete imported.source;
    await openFace(imported);
    expect(view.container.querySelector("[data-repaint-family]")).toBeNull();
    expect(view.container.querySelector("[data-repaint-expired]")).toBeNull();
  });
});
