// The overlay's URL (spec avatar-reach 3.2, design "Testing"): parseOverlayParams as a table, the
// background colour, and the setup's builder round-tripping through the parser.
import { describe, expect, it } from "vitest";
import { backgroundColour, buildOverlayUrl, CHROMA_GREEN, parseOverlayParams, type OverlayParams } from "./params";

describe("parseOverlayParams", () => {
  const rows: [string, OverlayParams][] = [
    ["", { bg: "transparent", mic: false }],
    ["?pack=malakor", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?pack=https%3A%2F%2Fexample.com%2Fa.srpack", { source: { pack: "https://example.com/a.srpack" }, bg: "transparent", mic: false }],
    ["?character=ghost-1", { source: { character: "ghost-1" }, bg: "transparent", mic: false }],
    ["?pack=malakor&character=ghost", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?pack=%20%20&character=ghost", { source: { character: "ghost" }, bg: "transparent", mic: false }],
    ["?pack=malakor&mood=Smug", { source: { pack: "malakor" }, mood: "smug", bg: "transparent", mic: false }],
    ["?pack=malakor&mood=joy", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?pack=malakor&bg=green", { source: { pack: "malakor" }, bg: "green", mic: false }],
    ["?pack=malakor&bg=%2300FF88", { source: { pack: "malakor" }, bg: "#00ff88", mic: false }],
    ["?pack=malakor&bg=112233", { source: { pack: "malakor" }, bg: "#112233", mic: false }],
    ["?pack=malakor&bg=red", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?pack=malakor&bg=%23abc", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?pack=malakor&mic=1", { source: { pack: "malakor" }, bg: "transparent", mic: true }],
    ["?pack=malakor&mic=true", { source: { pack: "malakor" }, bg: "transparent", mic: true }],
    ["?pack=malakor&mic=0", { source: { pack: "malakor" }, bg: "transparent", mic: false }],
    ["?mood=smug&bg=green&mic=1", { mood: "smug", bg: "green", mic: true }],
  ];
  it.each(rows)("%s", (search, expected) => {
    expect(parseOverlayParams(search)).toEqual(expected);
  });
});

describe("backgroundColour", () => {
  it("paints transparent, the chroma green, or the colour itself", () => {
    expect(backgroundColour("transparent")).toBe("transparent");
    expect(backgroundColour("green")).toBe(CHROMA_GREEN);
    expect(backgroundColour("#123456")).toBe("#123456");
  });
});

describe("buildOverlayUrl", () => {
  it("names only what differs from the defaults", () => {
    expect(buildOverlayUrl("https://sr.example", { source: { pack: "malakor" }, bg: "transparent", mic: false })).toBe(
      "https://sr.example/overlay?pack=malakor",
    );
    expect(buildOverlayUrl("https://sr.example/", { bg: "transparent", mic: false })).toBe("https://sr.example/overlay");
  });

  it("encodes the colour's # so a pasted URL keeps it", () => {
    const url = buildOverlayUrl("http://localhost:5173", { source: { character: "ghost" }, mood: "grim", bg: "#00ff88", mic: true });
    expect(url).toBe("http://localhost:5173/overlay?character=ghost&mood=grim&bg=%2300ff88&mic=1");
  });

  it("round-trips through the parser", () => {
    const params: OverlayParams = { source: { pack: "https://cdn.example/x.srpack" }, mood: "furious", bg: "green", mic: true };
    expect(parseOverlayParams(new URL(buildOverlayUrl("https://sr.example", params)).search)).toEqual(params);
  });
});
