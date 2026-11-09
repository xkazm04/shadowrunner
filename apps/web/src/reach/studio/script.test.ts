// The studio's script model (perfection-pass task 6, requirement 6.1): recorded lines carry their
// recorded mood and gesture, overrides omit absent keys, add/remove/move keep the limits, and the
// rows read back as the design's line model. Plus the framing rule and the take stage (aspect.ts,
// takeStage.ts), which are as small.
import { describe, expect, it, vi } from "vitest";
import { ASPECTS, placeRig } from "./aspect";
import { addRow, MAX_SCRIPT_LINES, moveRow, nextRecorded, recordedRow, removeRow, repick, scriptOf, scriptReady, typedRow, withField } from "./script";
import { fan, takeStage } from "./takeStage";

const b00 = { text: "The throne room is open.", url: "/a/b00.wav", emotion: "theatrical" as const, gesture: "flare" as const };
const b07 = { text: "A dispatch arrives.", url: "/a/b07.wav", emotion: "grim" as const };

describe("script rows", () => {
  it("a recorded line starts in its recorded mood and gesture; picking another clip resets them", () => {
    const row = recordedRow(b00);
    expect(scriptOf([row])).toEqual([{ text: b00.text, url: b00.url, emotion: "theatrical", gesture: "flare" }]);
    const changed = withField(withField(row, "emotion", "smug"), "gesture", undefined);
    expect(scriptOf([changed])).toEqual([{ text: b00.text, url: b00.url, emotion: "smug" }]);
    expect("gesture" in changed).toBe(false);
    const again = repick(changed, b07);
    expect(again.id).toBe(row.id);
    expect(scriptOf([again])).toEqual([{ text: b07.text, url: b07.url, emotion: "grim" }]);
  });

  it("adds up to the limit, removes, and moves within the list", () => {
    let rows = [recordedRow(b00)];
    for (let i = 0; i < MAX_SCRIPT_LINES + 3; i += 1) rows = addRow(rows, typedRow(`line ${i}`));
    expect(rows).toHaveLength(MAX_SCRIPT_LINES);
    const [first, second] = rows;
    expect(moveRow(rows, first?.id ?? -1, 1).slice(0, 2)).toEqual([second, first]);
    expect(moveRow(rows, first?.id ?? -1, -1)[0]).toBe(first);
    expect(moveRow(rows, rows.at(-1)?.id ?? -1, 5).at(-1)).toBe(rows.at(-1));
    expect(removeRow(rows, first?.id ?? -1)).toHaveLength(MAX_SCRIPT_LINES - 1);
  });

  it("is ready when every line says something", () => {
    expect(scriptReady([])).toBe(false);
    expect(scriptReady([typedRow("  ")])).toBe(false);
    expect(scriptReady([typedRow("Hello"), recordedRow(b00)])).toBe(true);
  });

  it("offers the next recorded line not yet in the script", () => {
    expect(nextRecorded([recordedRow(b00)], [b00, b07])).toBe(b07);
    expect(nextRecorded([recordedRow(b00), recordedRow(b07)], [b00, b07])).toBe(b00);
  });
});

describe("framing (aspect.ts)", () => {
  it("fits the whole rig, centred across, standing on the bottom edge", () => {
    const rig = { width: 1024, height: 1024 };
    const [, square, portrait, landscape] = ASPECTS;
    expect(placeRig(rig, square?.size ?? rig)).toEqual({ x: 0, y: 0, width: 1080, height: 1080 });
    expect(placeRig(rig, portrait?.size ?? rig)).toEqual({ x: 0, y: 840, width: 1080, height: 1080 });
    expect(placeRig(rig, landscape?.size ?? rig)).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(placeRig({ width: 800, height: 1000 }, { width: 1920, height: 1080 })).toEqual({ x: 528, y: 0, width: 864, height: 1080 });
  });
});

describe("takeStage", () => {
  const player = () => ({
    attachAudio: vi.fn(),
    renderFrame: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setMouthShapes: vi.fn(),
    mouthMode: () => "warp" as const,
    setEmotion: vi.fn(),
    gesture: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    setLook: vi.fn(),
    setLevel: vi.fn(),
  });

  it("sizes a second player to the rig's rect at DPR 1, mirrors every call on the screen, disposes only its own", () => {
    const take = player();
    const screen = player();
    const make = vi.fn(() => take);
    const canvas = {} as HTMLCanvasElement;
    const rig = { width: 1024, height: 1024 } as Parameters<typeof takeStage>[1]["rig"];
    const stage = takeStage(screen, { rig, look: {} as Parameters<typeof takeStage>[1]["look"], assets: {}, reducedMotion: false }, { width: 1080, height: 1920 }, canvas, make);
    expect(make).toHaveBeenCalledWith(canvas, expect.objectContaining({ autoSize: false, reducedMotion: false }));
    expect(take.resize).toHaveBeenCalledWith(1080, 1080, 1);
    expect(stage?.place).toEqual({ x: 0, y: 840, width: 1080, height: 1080 });
    stage?.player.renderFrame(0.033);
    expect(screen.renderFrame).not.toHaveBeenCalled();
    stage?.player.renderFrame(0.033);
    // The mirror draws every second take frame, stepped by both frames' time.
    expect(screen.renderFrame.mock.calls).toEqual([[expect.closeTo(0.066, 9)]]);
    expect(take.renderFrame).toHaveBeenCalledTimes(2);
    stage?.player.setEmotion("grim");
    stage?.player.gesture("nod");
    stage?.player.stop();
    stage?.player.start();
    for (const p of [take, screen]) {
      expect(p.setEmotion).toHaveBeenCalledWith("grim");
      expect(p.gesture).toHaveBeenCalledWith("nod");
      expect(p.stop).toHaveBeenCalled();
    }
    expect(take.start).not.toHaveBeenCalled();
    expect(screen.start).toHaveBeenCalled();
    stage?.dispose();
    expect(take.dispose).toHaveBeenCalled();
    expect(screen.dispose).not.toHaveBeenCalled();
    expect(fan(take, screen).mouthMode?.()).toBe("warp");
  });

  it("is undefined when the second player cannot draw", () => {
    const fail = () => {
      throw new Error("no webgl");
    };
    const rig = { width: 1, height: 1 } as Parameters<typeof takeStage>[1]["rig"];
    expect(takeStage(player(), { rig, look: {} as Parameters<typeof takeStage>[1]["look"], assets: {} }, { width: 2, height: 2 }, {} as HTMLCanvasElement, fail)).toBeUndefined();
  });
});
