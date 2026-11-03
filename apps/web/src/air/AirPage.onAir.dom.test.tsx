// @vitest-environment happy-dom
// character-control task 4, requirement 6: the stage shows the character "Put on air" recorded,
// with its saved look (the stage still leaves the backdrop out), and Malakor when the record is
// missing. <AvatarCanvas> is a probe; the library is the in-memory twin.
import type { AvatarCanvasProps } from "@sr/avatar";
import { defaultLook } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { memoryLibrary, type CharacterRecord, type LibraryStore } from "../creator/library/libraryStore";
import { testRig } from "../creator/testFixtures";
import { AirPage } from "./AirPage";
import { ON_AIR_KEY } from "./onAir";

const renders: AvatarCanvasProps[] = [];
let store: LibraryStore = memoryLibrary();

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

function record(): CharacterRecord {
  const rig = testRig("ghost-1", "Ghost One");
  const assets = Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.file])]));
  const look = { ...defaultLook(rig), hidden: ["crown"], shape: { crown: { size: 1.5, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 } } };
  return { id: rig.id, rig, assets, look, voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

let m: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  renders.length = 0;
  store = memoryLibrary();
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await elapse(0);
}

describe("AirPage on air", () => {
  it("loads the stored record with its saved look", async () => {
    await store.put(record());
    window.localStorage.setItem(ON_AIR_KEY, "ghost-1");
    m = await mount(<AirPage plane="replay" />);
    await settle();
    const face = renders.at(-1);
    expect(face?.rig.id).toBe("ghost-1");
    expect(face?.look.shape?.crown?.size).toBe(1.5);
    expect(face?.look.hidden).toEqual(["background", "crown"]);
    expect(m.container.querySelector("h1")?.textContent).toBe("Ghost One");
  });

  it("falls back to Malakor when the recorded character is gone", async () => {
    window.localStorage.setItem(ON_AIR_KEY, "ghost-1");
    m = await mount(<AirPage plane="replay" />);
    await settle();
    const face = renders.at(-1);
    expect(face?.rig.layers.some((l) => l.name === "crown_ring" || l.kind === "crown")).toBe(true);
    expect(face?.rig.id).not.toBe("ghost-1");
    expect(face?.look.hidden).toEqual(["background"]);
    expect(m.container.querySelector("h1")?.textContent).toBe("Arch-Lich Malakor");
  });
});
