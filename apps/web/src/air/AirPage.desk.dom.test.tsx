// @vitest-environment happy-dom
// The producer desk on the stage (challenge-2026-11-17 air/B): H holds the show and the slate says
// HELD while it is held (bound to the show's state), H again resumes; S cuts the line; a chat
// message's cue button has the co-host answer it next. Keys typed into the chat box are not the
// desk's. fetch is faked (no network): the replay engine answers from the recorded show, the voice
// fails (captions only, a line holds for the 9 s beat).
import { ScriptedEngine, type EngineRequest } from "@sr/engine";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { AirPage } from "./AirPage";
import { malakorShow } from "./malakor";

vi.mock(import("./malakor"), async (original) => ({ ...(await original()), loadRigAssets: async () => ({}) }));

let m: Mounted | undefined;
const engine = new ScriptedEngine(malakorShow());
const engineCalls: EngineRequest[] = [];

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === "/api/health") return Response.json({ plane: "replay", engine: "scripted", version: "dev" });
  if (url === "/api/engine/reply") {
    const req = JSON.parse(String(init?.body)) as EngineRequest;
    engineCalls.push(req);
    return Response.json(await engine.reply(req));
  }
  return new Response("", { status: 500 });
}

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await elapse(Math.min(250, ms - t));
    for (let i = 0; i < 10; i += 1) await elapse(0);
  }
}

const key = async (k: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
};
const q = (sel: string) => m?.container.querySelector<HTMLElement>(sel) ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  engineCalls.length = 0;
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirPage producer desk", () => {
  it("H holds the show (HELD on the slate, no beats), H again resumes", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(3_000);
    expect(q("[data-held]")).toBeNull();
    expect(await key("h")).toBe(true);
    expect(q("[data-held]")?.textContent).toContain("HELD");
    const asked = engineCalls.length;
    await run(30_000);
    expect(engineCalls).toHaveLength(asked);
    expect(await key("H")).toBe(true);
    expect(q("[data-held]")).toBeNull();
    await run(500);
    expect(engineCalls).toHaveLength(asked + 1);
  });

  it("S cuts the line and the next one starts at once", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(3_000);
    const line = q("[data-captions]")?.textContent;
    expect(await key("s")).toBe(true);
    await run(250);
    expect(engineCalls).toHaveLength(2);
    expect(q("[data-captions]")?.textContent).not.toBe(line);
  });

  it("ignores H and S typed into the chat box", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(3_000);
    const input = m.container.querySelector<HTMLInputElement>("#air-say");
    if (input) {
      expect(await key("h", input)).toBe(false);
      expect(await key("s", input)).toBe(false);
    }
    expect(q("[data-held]")).toBeNull();
    expect(engineCalls).toHaveLength(1);
  });

  it("a message's cue button marks it cued and the next beat answers it", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(8_000);
    const first = q('[data-id="a01"]');
    const cue = first?.querySelector<HTMLButtonElement>("button[data-cue]");
    expect(cue?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => cue?.click());
    expect(q('[data-id="a01"]')?.dataset.cued).toBe("");
    expect(q('[data-id="a01"] button[data-cue]')?.getAttribute("aria-pressed")).toBe("true");
    await run(2_000);
    expect(engineCalls[1]?.pickedId).toBe("a01");
    // The character's own lines carry no cue button.
    expect(q('[data-kind="self"] button[data-cue]')).toBeNull();
  });
});
