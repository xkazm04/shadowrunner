// @vitest-environment happy-dom
// C4: a forged character with a sheet goes on air as itself. On the replay plane its own example
// lines play as a scripted loop answered in the browser: zero requests to the engine or the voice
// (the paid endpoints), captions follow the script, chat posts under its chat name, and the slate
// says SCRIPTED. On the live plane the engine is asked with its own persona. fetch is faked.
import type { AvatarCanvasProps } from "@sr/avatar";
import type { EngineRequest } from "@sr/engine";
import { defaultLook } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { memoryLibrary, type CharacterRecord, type LibraryStore } from "../creator/library/libraryStore";
import { testRig } from "../creator/testFixtures";
import { AirPage } from "./AirPage";
import { ON_AIR_KEY } from "./onAir";

const LINES = ["Forty fathoms of chat and not one pearl.", "Bubbles mean I am laughing."];
let store: LibraryStore = memoryLibrary();
const calls: string[] = [];
const engineBodies: EngineRequest[] = [];

vi.mock(import("@sr/avatar"), async (original) => ({ ...(await original()), AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-rig={props.rig.id} /> }));
vi.mock(import("../creator/library/assets"), async (original) => ({ ...(await original()), rigAssetsOf: async () => ({}) }));
vi.mock(import("../creator/library/libraryStore"), async (original) => ({ ...(await original()), openLibrary: async () => store }));
vi.mock(import("./malakor"), async (original) => ({ ...(await original()), loadRigAssets: async () => ({}) }));

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  calls.push(url);
  if (url === "/api/health") return Response.json({ plane: "replay", engine: "scripted", version: "dev" });
  if (url === "/api/engine/reply") {
    engineBodies.push(JSON.parse(String(init?.body)) as EngineRequest);
    return Response.json({ line: "A live line.", emotion: "neutral" });
  }
  return new Response("", { status: 404 });
}

function record(): CharacterRecord {
  const rig = testRig("forge-brine", "Brine, of the Forty Fathoms");
  const assets = Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.file])]));
  return {
    id: rig.id,
    rig,
    assets,
    look: defaultLook(rig),
    voice: "choir",
    createdAt: "2026-11-07T00:00:00.000Z",
    sheet: { archetype: "Drowned diver", hook: "Hums shanties between lines.", lines: LINES },
  };
}

let m: Mounted | undefined;

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await elapse(Math.min(250, ms - t));
    for (let i = 0; i < 10; i += 1) await elapse(0);
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  calls.length = 0;
  engineBodies.length = 0;
  store = memoryLibrary();
  await store.put(record());
  window.localStorage.setItem(ON_AIR_KEY, "forge-brine");
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const captions = () => m?.container.querySelector("[data-captions]")?.textContent ?? "";
const PAID = ["/api/engine/reply", "/api/voice"];

describe("a forged character with a sheet on air", () => {
  it("on replay: plays its own lines in a loop, captions only, SCRIPTED, zero paid calls", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(1_000);
    expect(m.container.querySelector("h1")?.textContent).toBe("Brine, of the Forty Fathoms");
    expect(m.container.querySelector('[data-script="sheet"]')?.textContent).toContain("SCRIPTED");
    expect(captions()).toContain(LINES[0]);
    await run(9_500);
    expect(captions()).toContain(LINES[1]);
    await run(9_500);
    expect(captions()).toContain(LINES[0]); // looped
    const posts = [...m.container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(posts.some((p) => p.includes("Brine") && p.includes(LINES[0] ?? "-"))).toBe(true);
    expect(posts.some((p) => p.includes("Fathoms"))).toBe(false); // posted under its chat name
    expect(calls.filter((u) => PAID.some((p) => u.startsWith(p)))).toEqual([]);
    expect(calls.every((u) => u === "/api/health")).toBe(true);
  });

  it("on live: asks the engine with its own name, sheet bible and chosen voice, never Malakor's", async () => {
    m = await mount(<AirPage plane="live" />);
    await run(1_000);
    expect(m.container.querySelector('[data-script="sheet"]')).toBeNull();
    const req = engineBodies[0];
    expect(req?.characterId).toBe("forge-brine");
    expect(req?.persona.name).toBe("Brine, of the Forty Fathoms");
    expect(req?.persona.voice).toBe("choir");
    expect(req?.persona.bible).toContain("Hums shanties between lines.");
    expect(req?.persona.bible).toContain(LINES[1]);
    expect(req?.persona.bible).not.toContain("Malakor");
  });
});
