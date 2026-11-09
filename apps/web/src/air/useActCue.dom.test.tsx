// @vitest-environment happy-dom
// perfection-pass 5.5: the act cue's cooldown rule. A cue word reached inside the cooldown is
// dropped (the act never fires late, away from its word), and the line's next cue word reached
// after the cooldown fires instead; at most one act per line. Caption-only lines (no audio), so
// the reading clock times the words; fake timers drive requestAnimationFrame and performance.now.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { ACT_COOLDOWN_MS, lineCues, type StageAct } from "./acts";
import type { Caption } from "./show";
import { useActCue, type ActFire } from "./useActCue";

const ACTS: readonly StageAct[] = [{ layer: "hand_r", cue: ["sold"] }];
const fires: (ActFire | undefined)[] = [];

function Probe({ caption }: { caption: Caption | undefined }) {
  fires.push(useActCue(caption, null, ACTS));
  return null;
}

const cap = (beat: number, line: string): Caption => ({ beat, line, reply: { line, emotion: "smug" }, voiced: false });

const fired = () => fires.at(-1)?.n ?? 0;

let m: Mounted | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  fires.length = 0;
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.useRealTimers();
});

describe("useActCue cooldown rule", () => {
  it("finds every cue word of a line, in order", () => {
    expect(lineCues("Sold! And sold again, SOLDER.", ACTS).map((c) => c.index)).toEqual([0, 10, 22]);
    expect(lineCues("nothing here", ACTS)).toEqual([]);
  });

  it("drops a cue inside the cooldown and fires on the line's next cue word after it", async () => {
    m = await mount(<Probe caption={cap(0, "Sold! The gavel falls.")} />);
    await elapse(100);
    expect(fired()).toBe(1);
    // One second later a line that opens on the cue word (inside the cooldown) and says it again
    // late in the line, well after the cooldown has run out.
    await elapse(900);
    const line = "Sold again, my friends, and the hall goes quiet while the clerk counts the coin, and then it is sold once more.";
    await m.rerender(<Probe caption={cap(1, line)} />);
    await elapse(200);
    expect(fired()).toBe(1);
    await elapse(ACT_COOLDOWN_MS + 6_000);
    expect(fired()).toBe(2);
    expect(fires.at(-1)?.layer).toBe("hand_r");
  });

  it("drops the act when the line's only cue word falls inside the cooldown", async () => {
    m = await mount(<Probe caption={cap(0, "Sold! The gavel falls.")} />);
    await elapse(100);
    await m.rerender(<Probe caption={cap(1, "Sold to the lady in grey, and that is that.")} />);
    await elapse(10_000);
    expect(fired()).toBe(1);
  });

  it("fires at most once per line even when every cue word is past the cooldown", async () => {
    m = await mount(<Probe caption={cap(0, "Going, going, sold, and sold, and sold again to the back row.")} />);
    await elapse(10_000);
    expect(fired()).toBe(1);
  });
});
