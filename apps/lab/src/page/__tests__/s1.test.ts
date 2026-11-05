import { describe, expect, it } from "vitest";
import type { SceneArgs } from "../../contract.js";
import { createS1Driver, type S1Driver } from "../scene/s1/driver.js";
import { CAPTION_HOLD_MS, LOOKS } from "../scene/s1/model.js";
import type { Canvas2D } from "../scene/s1/paint.js";
import { readPalette, ROLES } from "../scene/s1/palette.js";
import type { SceneContext, ScenePainter, StageAudio, Utterance } from "../types.js";

/** A 2D context that logs every draw call with the fill style and alpha in force. */
class MockContext implements Canvas2D {
  readonly canvas = { width: 1920, height: 1080 };
  readonly log: string[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  font = "";
  lineWidth = 1;
  textAlign: CanvasTextAlign = "left";
  textBaseline: CanvasTextBaseline = "alphabetic";
  #gradients = 0;
  #state(): string {
    const fill = typeof this.fillStyle === "string" ? this.fillStyle : String(this.fillStyle);
    return `${fill}@${this.globalAlpha.toFixed(3)}`;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`fillRect ${x | 0},${y | 0},${w | 0},${h | 0} ${this.#state()}`);
  }
  fillText(text: string, x: number, y: number): void {
    this.log.push(`fillText "${text}" ${x | 0},${y | 0} ${this.font} ${this.#state()}`);
  }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    this.log.push(`ellipse ${x | 0},${y | 0},${rx.toFixed(1)},${ry.toFixed(1)}`);
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`roundRect ${x | 0},${y | 0},${w | 0},${h | 0}`);
  }
  beginPath(): void {}
  fill(): void {
    this.log.push(`fill ${this.#state()}`);
  }
  stroke(): void {
    this.log.push(`stroke ${String(this.strokeStyle)}`);
  }
  measureText(text: string): TextMetrics {
    return { width: text.length * 20 } as TextMetrics;
  }
  createRadialGradient(...args: number[]): CanvasGradient {
    const id = `gradient${(this.#gradients += 1)}(${args.map((a) => a | 0).join(",")})`;
    const stops: string[] = [];
    const addColorStop = (o: number, c: string): void => {
      stops.push(`${o}:${c}`);
    };
    return Object.assign({ addColorStop }, { toString: () => `${id}[${stops.join(" ")}]` });
  }
}

const palette = readPalette((role) => `role(${role})`);

interface Harness {
  driver: S1Driver;
  at(ms: number): string[];
  utter(u: Omit<Utterance, "durationMs"> & { durationMs?: number }): void;
  apply(args: SceneArgs, atMs: number): void;
}

function harness(reducedMotion = false): Harness {
  let now = 0;
  const hooks: ((n: number) => void)[] = [];
  const painters: Record<"back" | "front", ScenePainter[]> = { back: [], front: [] };
  const utterances: ((u: Utterance) => void)[] = [];
  const audio: StageAudio = { context: {} as AudioContext, output: {} as GainNode, nowMs: () => now, level: () => 0 };
  const ctx: SceneContext = {
    stage: {} as HTMLElement,
    audio,
    reducedMotion,
    onFrame: (h) => hooks.push(h),
    addPainter: (layer, p) => painters[layer].push(p),
    onUtterance: (h) => utterances.push(h),
  };
  const driver = createS1Driver(ctx, palette);
  return {
    driver,
    at(ms) {
      now = ms;
      for (const h of hooks) h(now);
      // The painters registered with the page are the driver's own, which take the narrow Canvas2D.
      expect(painters.back).toEqual([driver.painters.back]);
      expect(painters.front).toEqual([driver.painters.front]);
      const g = new MockContext();
      driver.painters.back(g, now);
      driver.painters.front(g, now);
      return g.log;
    },
    utter(u) {
      for (const h of utterances) h({ durationMs: 2000, ...u });
    },
    apply(args, atMs) {
      now = atMs;
      driver.apply({ t: atMs, kind: "scene", ...args });
    },
  };
}

const OPS: SceneArgs[] = [
  { op: "light", cue: "dim" },
  { op: "light", cue: "warm" },
  { op: "light", cue: "cold" },
  { op: "light", cue: "flicker" },
  { op: "light", cue: "blackout" },
  { op: "candles", action: "burst" },
  { op: "candles", action: "dim" },
  { op: "candles", action: "steady" },
  { op: "card", action: "show", id: "census", title: "Room Census", body: "12 souls counted" },
  { op: "poll", action: "open", question: "Count the moth?", options: ["yes", "no"] },
];

describe("S1 scene driver", () => {
  it("registers, paints back and front, and draws a different picture for every op", () => {
    expect(Object.keys(ROLES)).toHaveLength(Object.keys(palette).length);
    const baseline = harness().at(5000).join("\n");
    const seen = new Map<string, string>();
    for (const op of OPS) {
      const h = harness();
      h.apply(op, 1000);
      const picture = h.at(5000).join("\n");
      expect(picture, JSON.stringify(op)).not.toBe(baseline);
      for (const [other, p] of seen) expect(picture, `${JSON.stringify(op)} vs ${other}`).not.toBe(p);
      seen.set(JSON.stringify(op), picture);
      expect(h.driver.model.applied[op.op]).toBe(1);
    }
  });

  it("captions each spoken line in the caption style in force, and drops it after the line", () => {
    const styles = (["plain", "whisper", "shout"] as const).map((style) => {
      const h = harness();
      h.apply({ op: "caption", style }, 0);
      h.utter({ id: "a", text: "Name recorded.", atMs: 100 });
      expect(h.at(50).some((l) => l.startsWith("fillText"))).toBe(false); // not before its audio
      const lines = h.at(1200).filter((l) => l.startsWith("fillText"));
      expect(lines.length).toBeGreaterThan(0);
      expect(h.at(100 + 2000 + CAPTION_HOLD_MS + 400).some((l) => l.startsWith("fillText"))).toBe(false);
      return lines.join("\n");
    });
    expect(styles[0]).toContain('"Name recorded."');
    expect(styles[1]).toContain("italic");
    expect(styles[2]).toContain('"NAME RECORDED."');
    expect(new Set(styles).size).toBe(3);
  });

  it("shows and hides a card, opens and closes a poll", () => {
    const h = harness();
    h.apply({ op: "card", action: "show", id: "census", title: "Room Census", body: "12 souls" }, 0);
    expect(h.at(1000).join("\n")).toContain('"Room Census"');
    h.apply({ op: "card", action: "hide", id: "other" }, 1000);
    expect(h.at(2000).join("\n")).toContain('"Room Census"'); // a different id hides nothing
    h.apply({ op: "card", action: "hide", id: "census" }, 2000);
    expect(h.at(3000).join("\n")).not.toContain("Room Census");

    h.apply({ op: "poll", action: "open", question: "Count the moth?", options: ["yes", "no"] }, 3000);
    const open = h.at(4000).join("\n");
    expect(open).toContain('"Count the moth?"');
    expect(open).toContain('"yes"');
    expect(open).not.toContain("POLL CLOSED");
    h.apply({ op: "poll", action: "close" }, 4000);
    expect(h.at(4500).join("\n")).toContain("POLL CLOSED");
    expect(h.at(8000).join("\n")).not.toContain("Count the moth?");
  });

  it("eases light changes and flickers with motion; cuts and holds steady under reduced motion", () => {
    const moving = harness();
    moving.apply({ op: "light", cue: "blackout" }, 1000);
    moving.at(1050);
    const mid = moving.driver.frame().light.dark;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(LOOKS.blackout.dark);
    moving.at(3000);
    expect(moving.driver.frame().light.dark).toBeCloseTo(LOOKS.blackout.dark);

    const reduced = harness(true);
    reduced.apply({ op: "light", cue: "blackout" }, 1000);
    reduced.at(1001);
    expect(reduced.driver.frame().light.dark).toBeCloseTo(LOOKS.blackout.dark);

    const levels = (h: Harness): Set<string> => {
      h.apply({ op: "light", cue: "flicker" }, 0);
      const out = new Set<string>();
      for (let t = 2000; t < 4000; t += 60) {
        h.at(t);
        out.add(h.driver.frame().light.level.toFixed(3));
      }
      return out;
    };
    expect(levels(harness()).size).toBeGreaterThan(5);
    expect(levels(harness(true)).size).toBe(1);
  });

  it("sways flames and spikes a burst with motion only", () => {
    const flames = (reduced: boolean): number[] => {
      const h = harness(reduced);
      h.apply({ op: "candles", action: "burst" }, 0);
      return [100, 400, 3000].map((t) => {
        h.at(t);
        return h.driver.frame().candles.flames[0] ?? 0;
      });
    };
    const [, early = 0, late = 0] = flames(false);
    expect(early).toBeGreaterThan(late);
    expect(new Set(flames(true)).size).toBe(1);
  });
});
