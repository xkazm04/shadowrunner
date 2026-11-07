// @vitest-environment happy-dom
// tiger L1: Lot Ninety on air with his recorded show (replay plane). His right glove's signature act
// (compiled at load time from his recorded brief, the recorded rig untouched) fires once on every
// line that says "Sold" and on no other line, timed to the word on the caption's reading clock; the
// only requests are health and the replay engine (the voice fails: captions only), no paid call.
// <AvatarCanvas> is a probe; the library is the in-memory twin; fetch is faked.
import type { AvatarCanvasProps } from "@sr/avatar";
import { castVoice, parseShow, ScriptedEngine, type EngineRequest } from "@sr/engine";
import { defaultLook, validateRig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lotNinetyJob from "../../../../assets/replay/forge/lot-ninety/job.json";
import lotNinetyNight from "../../../../assets/replay/shows/lot-ninety-night.json";
import { elapse, mount, type Mounted } from "../app/testDom";
import { memoryLibrary, type CharacterRecord, type LibraryStore } from "../creator/library/libraryStore";
import { AirPage } from "./AirPage";
import { ON_AIR_KEY } from "./onAir";

const renders: AvatarCanvasProps[] = [];
const calls: string[] = [];
let store: LibraryStore = memoryLibrary();
const show = parseShow(lotNinetyNight);
if (show === undefined) throw new Error("lot-ninety-night does not validate");
const engine = new ScriptedEngine(show);

vi.mock(import("@sr/avatar"), async (original) => ({
  ...(await original()),
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("../creator/library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));
vi.mock(import("../creator/library/libraryStore"), async (original) => ({ ...(await original()), openLibrary: async () => store }));
vi.mock(import("./malakor"), async (original) => ({ ...(await original()), loadRigAssets: async () => ({}) }));

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  calls.push(url);
  if (url === "/api/health") return Response.json({ plane: "replay", engine: "scripted", version: "dev" });
  if (url === "/api/engine/reply") return Response.json(await engine.reply(JSON.parse(String(init?.body)) as EngineRequest));
  return new Response("", { status: 500 });
}

function record(): CharacterRecord {
  const read = validateRig(lotNinetyJob.rig);
  if (!read.ok) throw new Error("lot-ninety rig does not validate");
  const rig = read.value;
  const voice = castVoice("lot-ninety");
  if (voice === undefined) throw new Error("no cast voice");
  return { id: "replay-lot-ninety", rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.file])])), look: defaultLook(rig), voice, createdAt: "2026-11-08T00:00:00.000Z" };
}

let m: Mounted | undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  renders.length = 0;
  calls.length = 0;
  store = memoryLibrary();
  await store.put(record());
  window.localStorage.setItem(ON_AIR_KEY, "replay-lot-ninety");
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Lot Ninety's 'sold' slam on air", () => {
  it("fires the glove's act on exactly the lines that say 'Sold', once each, with no paid call", async () => {
    m = await mount(<AirPage plane="replay" />);
    const lines: string[] = [];
    const fires = new Map<number, string>();
    for (let t = 0; t < 80_000; t += 100) {
      await elapse(100);
      for (let i = 0; i < 4; i += 1) await elapse(0);
      const text = m.container.querySelector("[data-captions]")?.textContent ?? "";
      const line = show.beats.find((b) => text.includes(b.reply.line))?.reply.line;
      if (line !== undefined && lines.at(-1) !== line) lines.push(line);
      const act = renders.at(-1)?.act;
      if (act !== undefined && !fires.has(act.n)) fires.set(act.n, `${act.layer}@${lines.at(-1) ?? ""}`);
    }
    const said = lines.filter((l) => /\bsold\b/i.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(said.length).toBeGreaterThanOrEqual(3);
    expect([...fires.values()]).toEqual(said.map((l) => `hand_r@${l}`));
    // The recorded rig stays as recorded: the act rides on the stage's copy.
    expect(renders.at(-1)?.rig.layers.find((l) => l.name === "hand_r")?.act).toEqual({ cue: ["sold"] });
    expect((await store.get("replay-lot-ninety"))?.kind === "ok").toBe(true);
    expect(calls.every((u) => u === "/api/health" || u === "/api/engine/reply" || u.startsWith("/api/voice"))).toBe(true);
    expect(calls.some((u) => u.startsWith("/api/forge"))).toBe(false);
  });
});
