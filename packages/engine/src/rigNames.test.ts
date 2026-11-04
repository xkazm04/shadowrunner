// avatar-pack: @sr/rig's readLook checks emotions and gestures against its own lists (rig cannot
// import the engine). These must stay the same sets as the engine's EMOTIONS / GESTURES.
import { EMOTIONS, GESTURES } from "@sr/engine";
import { EMOTION_TABLE, GESTURE_NAMES } from "@sr/rig";
import { describe, expect, it } from "vitest";

const sorted = (items: readonly string[]): string[] => [...items].sort();

describe("engine and rig name the same emotions and gestures", () => {
  it("EMOTIONS equals the keys of EMOTION_TABLE", () => {
    expect(sorted(EMOTIONS)).toEqual(sorted(Object.keys(EMOTION_TABLE)));
  });

  it("GESTURES equals GESTURE_NAMES", () => {
    expect(sorted(GESTURES)).toEqual(sorted(GESTURE_NAMES));
  });
});
