// @vitest-environment happy-dom
// The stage as a component (voice-and-air task 6, costume task 6): it enters the dead line when
// /api/health fails and recovers by itself when health answers; the lamp follows; the wall candles
// take their light from chat velocity and stand still when the theme does not haunt; the channel
// strip opens on C and the first Esc closes it without leaving. fetch is faked (no network): the
// replay engine answers from the recorded show, the voice fails (captions only).
import { ScriptedEngine, type EngineRequest } from "@sr/engine";
import { act } from "react";
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
  document.documentElement.style.removeProperty("--sr-haunt-flicker");
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

describe("AirPage candles", () => {
  const candles = () => [...(m?.container.querySelectorAll<HTMLElement>("[data-candle]") ?? [])];
  const level = (el: HTMLElement | undefined, v: string) => Number(el?.style.getPropertyValue(v));

  it("lights eight candles from chat velocity when the theme haunts", async () => {
    document.documentElement.style.setProperty("--sr-haunt-flicker", "0.4");
    healthy = true;
    m = await mount(<AirPage plane="replay" />);
    await run(1_000);
    expect(candles()).toHaveLength(8);
    const idle = candles().map((el) => level(el, "--glow"));
    await run(30_000);
    expect(stage()?.dataset.haunt).toBe("on");
    const busy = candles().map((el) => level(el, "--glow"));
    busy.forEach((v, i) => {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(idle[i] ?? 1);
    });
    expect(Number(stage()?.style.getPropertyValue("--heat"))).toBeGreaterThan(0);
  });

  it("stills the candles at their resting light when the theme does not haunt, however busy chat is", async () => {
    healthy = true;
    m = await mount(<AirPage plane="replay" />);
    await run(30_000);
    expect(stage()?.dataset.haunt).toBe("off");
    expect(Number(stage()?.style.getPropertyValue("--heat"))).toBe(0);
    const rest = candles().map((el) => el.style.getPropertyValue("--flame"));
    expect(new Set(rest).size).toBe(1);
    await run(5_000);
    expect(candles().map((el) => el.style.getPropertyValue("--flame"))).toEqual(rest);
  });
});

describe("AirPage channel strip", () => {
  const key = async (k: string, target: EventTarget = document.body) => {
    const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  const strip = (open: boolean) => (
    <nav data-strip="stage" data-open={open ? "" : undefined}>
      <a href="/" aria-current="page">
        2
      </a>
    </nav>
  );
  const nav = () => m?.container.querySelector<HTMLElement>('[data-strip="stage"]');

  it("opens on C, and the first Esc closes it and is not passed on to the shell", async () => {
    m = await mount(<AirPage plane="replay" strip={strip} />);
    expect(nav()?.dataset.open).toBeUndefined();
    expect(await key("c")).toBe(true);
    expect(nav()?.dataset.open).toBe("");
    expect(await key("Escape")).toBe(true); // taken: the shell's Esc does not see it
    expect(nav()?.dataset.open).toBeUndefined();
    expect(await key("Escape")).toBe(false); // closed: Esc is the shell's again (back to the set)
  });

  it("ignores C typed into the chat box", async () => {
    m = await mount(<AirPage plane="replay" strip={strip} />);
    const input = m.container.querySelector<HTMLInputElement>("#air-say");
    expect(input).not.toBeNull();
    if (input) await key("c", input);
    expect(nav()?.dataset.open).toBeUndefined();
  });
});
