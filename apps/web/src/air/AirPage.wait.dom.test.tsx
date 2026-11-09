// @vitest-environment happy-dom
// Never dead air on the stage (perfection-pass 5.1-5.4): while the next line is on the way the face
// listens toward the chat and takes the reply's emotion as soon as it lands, the bar says he is
// thinking (busy, so a screen reader is not told every beat), the visitor's message is marked
// queued, then answering; the grain lies over the set; the live plane fetches one line ahead and
// replay does not. <AvatarCanvas> is a probe; fetch is faked and slow (fake timers); the voice
// fails slowly, twice (captions only). No network, no key.
import type { AvatarCanvasProps } from "@sr/avatar";
import { ScriptedEngine, type EngineRequest } from "@sr/engine";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { AirPage } from "./AirPage";
import { waitingLine } from "./Captions";
import { MALAKOR_NAME, malakorShow } from "./malakor";
import { THINK_DELAY_MS } from "./show";

const renders: AvatarCanvasProps[] = [];
const engineCalls: EngineRequest[] = [];
let plane: "replay" | "live" = "replay";
const engine = new ScriptedEngine({ ...malakorShow(), audience: [] });

vi.mock(import("@sr/avatar"), async (original) => ({
  ...(await original()),
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("./malakor"), async (original) => ({ ...(await original()), loadRigAssets: async () => ({}) }));
// No recorded show audience: the visitor is the only one to answer.
vi.mock(import("./cast"), async (original) => {
  const real = await original();
  return { ...real, castFor: (...args: Parameters<typeof real.castFor>) => ({ ...real.castFor(...args), show: { ...real.castFor(...args).show, audience: [] } }) };
});

const REPLY_MS = 1_000;
const VOICE_MS = 1_000;
/** A line airs (captions only) after its reply and two failed voice attempts. */
const LINE_UP = REPLY_MS + 2 * VOICE_MS;

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === "/api/health") return Response.json({ plane, engine: plane === "live" ? "anthropic" : "scripted", version: "dev" });
  if (url === "/api/engine/reply") {
    const req = JSON.parse(String(init?.body)) as EngineRequest;
    engineCalls.push(req);
    await new Promise((resolve) => setTimeout(resolve, REPLY_MS));
    return Response.json(await engine.reply(req));
  }
  await new Promise((resolve) => setTimeout(resolve, VOICE_MS));
  return new Response("", { status: 500 });
}

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 50) {
    await elapse(Math.min(50, ms - t));
    for (let i = 0; i < 4; i += 1) await elapse(0);
  }
}

let m: Mounted | undefined;
const q = (sel: string) => m?.container.querySelector<HTMLElement>(sel) ?? null;
const face = () => renders.at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  renders.length = 0;
  engineCalls.length = 0;
  plane = "replay";
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirPage between lines", () => {
  it("shows nothing for a short wait, then a thinking face and bar, then the reply's emotion before the line", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(100);
    expect(q("[data-captions]")?.dataset.pending).toBeUndefined();
    await run(THINK_DELAY_MS + 100);
    // Thinking: eyes to the chat, a tilt, the waiting line in a busy bar.
    expect(q("[data-captions]")?.dataset.pending).toBe("reply");
    expect(q("[data-waiting]")?.textContent).toContain(waitingLine(MALAKOR_NAME, "reply"));
    expect(q("[aria-live]")?.getAttribute("aria-busy")).toBe("true");
    expect(face()).toMatchObject({ gaze: "chat", gesture: "tilt" });
    // The reply lands: its emotion is on the face and in the bar while the voice is still on the way.
    await run(REPLY_MS);
    const req = engineCalls[0];
    if (req === undefined) throw new Error("no engine call");
    const reply = await engine.reply(req);
    expect(q("[data-captions]")?.dataset.pending).toBe("voice");
    expect(face()?.look.emotion).toBe(reply.emotion);
    expect(face()?.gesture).toBeUndefined(); // the reply's gesture waits for the spoken line
    expect(q("[data-captions]")?.textContent).toContain(reply.emotion);
    expect(q("[data-waiting]")?.textContent).toContain(waitingLine(MALAKOR_NAME, "voice"));
    // The line airs: no longer busy, eyes back on the room, the same emotion.
    await run(2 * VOICE_MS);
    expect(q("[data-captions]")?.dataset.pending).toBeUndefined();
    expect(q("[aria-live]")?.hasAttribute("aria-busy")).toBe(false);
    expect(q("[data-captions]")?.textContent).toContain(reply.line);
    expect(face()?.gaze).toBeUndefined();
    expect(face()?.look.emotion).toBe(reply.emotion);
  });

  it("marks the visitor's message queued, then answering, then answered", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(LINE_UP + 500); // line 0 is up (captions only)
    const input = m.container.querySelector<HTMLInputElement>("#air-say");
    const form = input?.form;
    await act(async () => {
      if (input) {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        set?.call(input, "is the orb heavy?");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      form?.requestSubmit();
    });
    const mine = () => m?.container.querySelector<HTMLElement>('[data-kind="visitor"]');
    expect(mine()?.dataset.queued).toBe("");
    expect(mine()?.textContent).toContain("queued");
    await run(9_000); // the caption-only beat ends; the next beat picks the visitor
    expect(mine()?.dataset.queued).toBeUndefined();
    expect(mine()?.dataset.pending).toBe("");
    expect(mine()?.textContent).toContain("answering");
    expect(q("[data-captions]")?.textContent).toContain("asked: is the orb heavy?");
    await run(LINE_UP + 200);
    expect(mine()?.dataset.answered).toBe("");
    expect(mine()?.dataset.pending).toBeUndefined();
  });

  it("lays the grain over the set, out of the way of the pointer and assistive tech", async () => {
    m = await mount(<AirPage plane="replay" />);
    const grain = q("[data-grain]");
    expect(grain).not.toBeNull();
    expect(grain?.getAttribute("aria-hidden")).toBe("true");
    expect(grain?.closest("section")?.getAttribute("aria-label")).toContain("on air");
  });
});

describe("AirPage prefetch by plane", () => {
  it.each([
    ["live", 2],
    ["replay", 1],
  ] as const)("on the %s plane asks for %i replies while the first line plays", async (which, calls) => {
    plane = which;
    m = await mount(<AirPage plane={which} />);
    await run(LINE_UP + 500);
    expect(q('[data-page="air"]')?.dataset.state).toBe("speaking");
    await run(REPLY_MS + 500);
    expect(engineCalls).toHaveLength(calls);
  });
});
