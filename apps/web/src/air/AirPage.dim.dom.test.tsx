// @vitest-environment happy-dom
// The stage's eyes-only dim: the dead line gives <AvatarCanvas> `dim` 1 (the renderer keeps only
// the eyes lit), recovery gives it back 0, and the face is no longer dimmed by a whole-element CSS
// brightness filter. <AvatarCanvas> is a probe, as in AirPage.onAir.dom.test.
import type { AvatarCanvasProps } from "@sr/avatar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { AirPage } from "./AirPage";
import { HEALTH_POLL_MS } from "./stage";

const renders: AvatarCanvasProps[] = [];
let healthy = false;

vi.mock(import("@sr/avatar"), async (original) => ({
  ...(await original()),
  AvatarCanvas: (props: AvatarCanvasProps) => {
    renders.push(props);
    return <div data-avatar="" />;
  },
}));
vi.mock(import("./malakor"), async (original) => ({ ...(await original()), loadRigAssets: async () => ({}) }));

let m: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/health" && healthy ? Response.json({ plane: "replay", engine: "scripted", version: "dev" }) : new Response("", { status: 404 }),
    ),
  );
  renders.length = 0;
  healthy = false;
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await elapse(Math.min(250, ms - t));
    for (let i = 0; i < 10; i += 1) await elapse(0);
  }
}

describe("AirPage eyes-only dim", () => {
  it("dims the face to its eyes on the dead line and lights it again on recovery", async () => {
    m = await mount(<AirPage plane="replay" />);
    await run(500);
    expect(m.container.querySelector<HTMLElement>('[data-page="air"]')?.dataset.state).toBe("dead_line");
    expect(renders.at(-1)?.dim).toBe(1);

    healthy = true;
    await run(HEALTH_POLL_MS);
    expect(m.container.querySelector<HTMLElement>('[data-page="air"]')?.dataset.state).not.toBe("dead_line");
    expect(renders.at(-1)?.dim).toBe(0);
  });
});
