// @vitest-environment happy-dom
// forge-creator C1, wake after eyes: a slow live forge on a fake clock. Assembly lands at 120 s, the
// eye step takes 35 s, each of the six faces 40 s (done at 395 s). Before C1 the rite failed at
// the five-minute cap; now the face is kept and wakes at ~155 s, the 300 s mark passes, the faces
// fold into the kept record (the visitor's look edit survives), and a reload mid-forge resumes.
// forge-creator L2: these cover the direct path (`casting={false}`); Cast.dom.test.tsx covers casting.
import type { AvatarCanvasProps } from "@sr/avatar";
import type { JobView } from "@sr/forge/wire";
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import { createReplayBriefClient } from "../briefClient";
import { JOB_KEY, readStoredJob, TIMEOUT_MS } from "../forge/useForgeJob";
import type { ForgeClient } from "../forgeClient";
import { memoryLibrary, type LibraryStore } from "../library/libraryStore";
import { PIXEL_PNG, testBriefs, testJob, testRig } from "../testFixtures";
import { RitePage } from "./RitePage";

vi.mock(import("../../app/plane"), async (original) => ({ ...(await original()), usePlane: () => "replay" as const }));
vi.mock(import("@sr/avatar"), () => ({ AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-rig={props.rig.id} /> }));
vi.mock(import("../library/assets"), async (original) => ({
  ...(await original()),
  rigAssetsOf: async () => ({}),
  urlsToBlobs: async (urls: Readonly<Record<string, string>>) => Object.fromEntries(Object.keys(urls).map((f) => [f, new Blob(["x"])])),
}));

const S = 1000;
const ASSEMBLED = 120 * S;
const EYES = 35 * S;
const FACE = 40 * S;
const AWAKE = ASSEMBLED + EYES;
const DONE = AWAKE + FACE * EXPRESSION_FAMILIES.length;
const RIG = testRig("forge-slow01", "Slow Ghost");
const FACE_LAYER: Record<ExpressionFamily, string> = { joy: "head", showman: "jaw", anger: "head", gloom: "eye_l", smug: "jaw", suspicion: "eye_r" };

/** The live job's rig with the first `n` families' patches. */
function rigWith(n: number): Rig {
  const families = EXPRESSION_FAMILIES.slice(0, n);
  return {
    ...RIG,
    layers: RIG.layers.map((l) => {
      const mine = families.filter((f) => FACE_LAYER[f] === l.name);
      if (mine.length === 0) return l;
      return { ...l, variants: Object.fromEntries(mine.map((f) => [f, { file: `${l.name}.${f}.png`, bbox: [l.bbox[0], l.bbox[1], 2, 2] as [number, number, number, number], mode: "over" as const }])) };
    }),
  };
}

const assetsOf = (rig: Rig): Record<string, string> =>
  Object.fromEntries(rig.layers.flatMap((l) => [[l.file, PIXEL_PNG], ...Object.values(l.variants ?? {}).map((p) => [p.file, PIXEL_PNG])]));

/** A live job on the fake clock, as toJobView sends it. */
function slowClient(log: string[]): ForgeClient {
  let startedAt = 0;
  return {
    async start() {
      startedAt = Date.now();
      return { jobId: "slow01" };
    },
    async poll(jobId) {
      log.push(jobId);
      const t = Date.now() - startedAt;
      const base = { jobId, plane: "live" as const, portraitUrl: PIXEL_PNG };
      if (t < 40 * S) return { jobId, plane: "live", status: t < 10 * S ? "queued" : "portrait" };
      if (t < ASSEMBLED) return { ...base, status: t < 70 * S ? "segmenting" : t < 100 * S ? "cutting" : "filling" };
      const n = Math.min(EXPRESSION_FAMILIES.length, Math.max(0, Math.floor((t - AWAKE) / FACE)));
      const expressions = Object.fromEntries(EXPRESSION_FAMILIES.slice(0, n).map((f) => [f, "ok" as const]));
      if (t < AWAKE) return { ...base, status: "expressing", expressions };
      const rig = rigWith(n);
      const view: JobView = { ...base, status: t >= DONE ? "done" : "expressing", rig, assets: assetsOf(rig), expressions };
      return view;
    },
  };
}

let view: Mounted;
let store: LibraryStore;
let t0 = 0;

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(client: ForgeClient): Promise<void> {
  view = await mount(<RitePage casting={false} client={client} briefer={createReplayBriefClient(async () => testBriefs())} jobs={async () => [testJob("ghost-a")]} library={{ open: async () => store, cast: async () => [] }} />);
  await flush();
}

function button(name: string): HTMLButtonElement {
  const b = [...view.container.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(name) || x.getAttribute("aria-label") === name);
  if (b === undefined) throw new Error(`no button ${name}`);
  return b;
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function forge(): Promise<void> {
  await click(button("Moth archivist"));
  await click(button("Brief it"));
  await flush();
  await click(button("Bind it"));
  await click(button("Forge it"));
  await flush();
  t0 = Date.now();
}

/** Advance the fake clock to `ms` after the start, a second at a time, letting React settle. */
async function until(ms: number): Promise<void> {
  while (Date.now() - t0 < ms) {
    await elapse(Math.min(1000, ms - (Date.now() - t0)));
    await flush();
  }
}

async function keptRig(): Promise<Rig | undefined> {
  const got = await store.get(RIG.id);
  return got?.kind === "ok" ? got.record.rig : undefined;
}
const faces = (rig: Rig | undefined): string[] => (rig?.layers ?? []).flatMap((l) => Object.keys(l.variants ?? {}).map((f) => `${l.name}.${f}`)).sort();
const step = (): string | null | undefined => view.container.querySelector("[data-page]")?.getAttribute("data-step");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  window.sessionStorage.removeItem(JOB_KEY);
  window.localStorage.clear();
  store = memoryLibrary();
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("wake after eyes, faces paint in", () => {
  it("keeps and wakes the face at ~155 s, passes the five-minute mark, and ends with every face in the record", async () => {
    await open(slowClient([]));
    await forge();
    await until(AWAKE - 2 * S);
    expect(await keptRig()).toBeUndefined();
    expect(view.container.querySelector("[data-avatar]")).toBeNull();
    await until(AWAKE + 6 * S);
    // The awake rig, named as the approved brief names it.
    expect(await keptRig()).toEqual({ ...RIG, name: expect.not.stringMatching(/^Slow Ghost$/) });
    expect(view.container.querySelector("[data-avatar]")).not.toBeNull();
    expect(view.container.querySelector("[data-painting]")?.textContent).toContain("Faces 0 / 6 painting");

    // The visitor tunes the awake face; the edit must survive every face that folds in.
    await click(button("monocle on the face"));
    await flush();

    await until(TIMEOUT_MS + 10 * S);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(step()).toBe("expressing");
    expect(faces(await keptRig())).toEqual(["head.anger", "head.joy", "jaw.showman"]);
    expect(view.container.querySelector("[data-painting]")?.textContent).toContain("Faces 3 / 6 painting");

    await until(DONE + 6 * S);
    expect(step()).toBe("done");
    const got = await store.get(RIG.id);
    expect(got?.kind).toBe("ok");
    if (got?.kind !== "ok") return;
    expect(faces(got.record.rig)).toEqual(faces(rigWith(6)));
    for (const file of Object.keys(assetsOf(rigWith(6)))) expect(got.record.assets[file]).toBeInstanceOf(Blob);
    expect(got.record.look.hidden).toContain("monocle");
    expect(view.container.querySelector("[data-painting]")).toBeNull();
    expect(window.sessionStorage.getItem(JOB_KEY)).toBeNull();
  }, 60_000);

  it("a reload mid-forge resumes the brief job's polling and still ends with every face", async () => {
    const log: string[] = [];
    const client = slowClient(log);
    await open(client);
    await forge();
    await until(AWAKE + 10 * S);
    const stored = readStoredJob(window.sessionStorage);
    expect(stored?.jobId).toBe("slow01");
    expect(stored?.request.mode).toBe("brief");
    expect(stored?.request.brief?.parts.length).toBeGreaterThan(0);
    expect(stored?.awakeAt).toBeGreaterThan(t0);

    await view.unmount();
    const before = log.length;
    await open(client);
    await until(AWAKE + 20 * S);
    expect(log.length).toBeGreaterThan(before);
    expect(step()).toBe("expressing");
    await until(DONE + 6 * S);
    expect(step()).toBe("done");
    expect(faces(await keptRig())).toEqual(faces(rigWith(6)));
  }, 60_000);

  it("S1: a family the gate refused carries its reading into the kept record mid-forge, and Wake says why", async () => {
    const reading = { reason: "iris" as const, irisDriftPx: 7.2, limit: 4, attempts: 3 };
    const inner = slowClient([]);
    const client: ForgeClient = {
      start: (req) => inner.start(req),
      async poll(jobId) {
        const v = await inner.poll(jobId);
        if (v.expressions?.gloom === undefined || v.rig === undefined) return v;
        // gloom is refused: no gloom patch, "skipped", and why.
        const rig = { ...v.rig, layers: v.rig.layers.map((l) => (l.variants?.gloom === undefined ? l : { ...l, variants: Object.fromEntries(Object.entries(l.variants).filter(([f]) => f !== "gloom")) })) };
        return { ...v, rig, assets: assetsOf(rig), expressions: { ...v.expressions, gloom: "skipped" }, expressionGate: { gloom: reading } };
      },
    };
    await open(client);
    await forge();
    await until(AWAKE + 4 * FACE + 6 * S);
    expect(step()).toBe("expressing");
    const mid = await store.get(RIG.id);
    expect(mid?.kind === "ok" && mid.record.faceGate).toEqual({ gloom: reading });
    await until(DONE + 6 * S);
    expect(step()).toBe("done");
    const got = await store.get(RIG.id);
    expect(got?.kind === "ok" && got.record.faceGate).toEqual({ gloom: reading });
    expect(got?.kind === "ok" && faces(got.record.rig)).not.toContain("eye_l.gloom");
    expect(view.container.querySelector("[data-procedural]")?.textContent).toBe("gloom · procedural, the eyes moved 7.2 px (limit 4)");
  }, 60_000);
});
