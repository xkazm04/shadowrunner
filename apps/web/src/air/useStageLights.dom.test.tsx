// @vitest-environment happy-dom
// The stage-light loop's paint contract (perfection-pass task 11): --back is written on the layers
// that read it (the tunnel and the bloom, `data-back`), never on the stage, and --heat on the plate
// image (`data-heat`, task 14); nothing is rewritten
// when its value has not changed; and the loop stops while the document is hidden and resumes when
// it is shown. requestAnimationFrame is driven by hand.
import { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../app/testDom";
import { CatacombLights, CatacombPlate } from "./Catacomb";
import { useStageLights } from "./useStageLights";

let m: Mounted | undefined;
let queue: FrameRequestCallback[] = [];
let hidden = false;
let clock = 0;

function Stage({ speaking, jaw }: { speaking: boolean; jaw: number }) {
  const root = useRef<HTMLDivElement>(null);
  const candles = useRef<(HTMLElement | null)[]>([]);
  useStageLights(
    { root, candles, chat: [], self: "Malakor", now: () => clock, jawOpen: () => jaw, speaking, dead: false },
    () => true,
  );
  return (
    <div ref={root} data-stage>
      <CatacombPlate candles={candles} />
      <CatacombLights />
    </div>
  );
}

/** Runs the frames waiting now, `ms` after the last. */
async function frame(ms = 16): Promise<void> {
  clock += ms;
  const due = queue;
  queue = [];
  await act(async () => {
    for (const cb of due) cb(clock);
  });
}

async function setHidden(value: boolean): Promise<void> {
  hidden = value;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const q = (sel: string) => m?.container.querySelector<HTMLElement>(sel) ?? null;
const readers = () => [...(m?.container.querySelectorAll<HTMLElement>("[data-back]") ?? [])];

beforeEach(() => {
  queue = [];
  clock = 0;
  hidden = false;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "hidden");
});

describe("useStageLights paint contract", () => {
  it("writes --back on the tunnel and the bloom, not on the stage", async () => {
    m = await mount(<Stage speaking jaw={0.5} />);
    for (let i = 0; i < 30; i += 1) await frame();
    expect(readers()).toHaveLength(2);
    for (const el of readers()) expect(Number(el.style.getPropertyValue("--back"))).toBeGreaterThan(0.3);
    expect(q("[data-stage]")?.style.getPropertyValue("--back")).toBe("");
  });

  it("writes --heat on the plate image, its one reader, not on the stage (task 14)", async () => {
    m = await mount(<Stage speaking={false} jaw={0} />);
    await frame();
    const heated = [...(m.container.querySelectorAll<HTMLElement>("[data-heat]") ?? [])];
    expect(heated).toHaveLength(1);
    expect(heated[0]?.style.getPropertyValue("--heat")).toBe("0");
    expect(q("[data-stage]")?.style.getPropertyValue("--heat")).toBe("");
  });

  it("does not rewrite a variable whose value has not changed", async () => {
    m = await mount(<Stage speaking={false} jaw={0} />);
    for (let i = 0; i < 5; i += 1) await frame();
    const candle = q('[data-candle="0"]');
    const tunnel = readers()[0];
    if (candle === null || tunnel === undefined) throw new Error("no stage");
    const candleSet = vi.spyOn(candle.style, "setProperty");
    const tunnelSet = vi.spyOn(tunnel.style, "setProperty");
    for (let i = 0; i < 10; i += 1) await frame();
    expect(candleSet).not.toHaveBeenCalled();
    expect(tunnelSet).not.toHaveBeenCalled();
  });

  it("stops while the document is hidden and resumes when it is shown", async () => {
    m = await mount(<Stage speaking jaw={0.5} />);
    await frame();
    expect(queue).toHaveLength(1);
    await setHidden(true);
    await frame();
    expect(queue).toHaveLength(0); // the hidden frame asked for no other
    await setHidden(false);
    expect(queue).toHaveLength(1);
    const before = Number(readers()[0]?.style.getPropertyValue("--back"));
    await frame(60_000);
    // No jump: the backlight eases on from where it stopped.
    expect(Math.abs(Number(readers()[0]?.style.getPropertyValue("--back")) - before)).toBeLessThan(0.1);
    expect(queue).toHaveLength(1);
  });
});
