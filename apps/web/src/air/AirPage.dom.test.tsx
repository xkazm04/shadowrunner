// @vitest-environment happy-dom
// The stage as a component (voice-and-air task 6): it enters the dead line when /api/health fails
// and recovers by itself when health answers; the lamp follows; the fog var is the one inline
// style and stays at zero when the theme does not haunt. fetch is faked (no network): the replay
// engine answers from the recorded show, the voice fails (captions only).
import { ScriptedEngine, type EngineRequest } from "@sr/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { AirPage } from "./AirPage";
import { DEAD_LINE_TEXT } from "./DeadLine";
import { malakorShow } from "./malakor";
import { HEALTH_POLL_MS } from "./stage";

let m: Mounted | undefined;
let healthy = false;
const engine = new ScriptedEngine(malakorShow());

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === "/api/health") {
    return healthy ? Response.json({ plane: "replay", engine: "scripted", version: "dev" }) : new Response("", { status: 404 });
  }
  if (url === "/api/engine/reply") return Response.json(await engine.reply(JSON.parse(String(init?.body)) as EngineRequest));
  return new Response("", { status: 500 });
}

const stage = () => m?.container.querySelector<HTMLElement>('[data-page="air"]');
const lamp = () => m?.container.querySelector<HTMLElement>('[role="status"]');

/** Lets fetches settle and timers run for `ms`, in steps. */
async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await elapse(Math.min(250, ms - t));
    for (let i = 0; i < 10; i += 1) await elapse(0);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  healthy = false;
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--sr-haunt-fog");
});

describe("AirPage and the dead line", () => {
  it("goes dark while health fails and comes back on air by itself when it answers", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(500);
    expect(stage()?.dataset.state).toBe("dead_line");
    expect(m.container.querySelector('[role="alert"]')?.textContent).toBe(DEAD_LINE_TEXT);
    expect(lamp()?.dataset.lit).toBe("off");
    expect(lamp()?.getAttribute("aria-label")).toBe("Off air");

    await run(HEALTH_POLL_MS);
    expect(stage()?.dataset.state).toBe("dead_line"); // still failing

    healthy = true;
    await run(HEALTH_POLL_MS);
    expect(["on_air", "speaking"]).toContain(stage()?.dataset.state);
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    expect(lamp()?.dataset.lit).toBe("on");
    expect(lamp()?.getAttribute("aria-label")).toBe("On air");
    await run(1_000);
    expect(stage()?.dataset.state).toBe("speaking"); // the show picked up where it stopped
  });

  it("speaks the line as captions only when the voice fails", async () => {
    healthy = true;
    m = await mount(<AirPage plane="replay" />);
    await run(1_000);
    expect(stage()?.dataset.state).toBe("speaking");
    expect(m.container.querySelector("[data-captions]")?.textContent).toContain("captions only");
  });
});

describe("AirPage fog", () => {
  it("keeps --sr-haunt-fog at zero when the theme does not haunt, however busy chat is", async () => {
    healthy = true;
    m = await mount(<AirPage plane="replay" />);
    await run(30_000);
    expect(stage()?.style.getPropertyValue("--sr-haunt-fog")).toBe("0");
  });

  it("thickens the fog with chat velocity when the theme haunts", async () => {
    document.documentElement.style.setProperty("--sr-haunt-fog", "0.35");
    healthy = true;
    m = await mount(<AirPage plane="replay" />);
    await run(30_000);
    const fog = Number(stage()?.style.getPropertyValue("--sr-haunt-fog"));
    expect(fog).toBeGreaterThan(0);
    expect(fog).toBeLessThanOrEqual(1);
  });
});
