// The glass (landing task 5.2): one superellipse clip for every layer, the lower third, the
// channel caption, NO CARRIER, and the on-air hook (requirement 3.5).
import { defaultLook, importLegacyLayers } from "@sr/rig";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES } from "../app/pages";
import { Glass, GLASS_CLIP, GlassCaption, LowerThird, PICTURE, RESIDENT, type OnAirCharacter } from "./Glass";
import { GLASS, PLATE } from "./superellipse";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";

const DIAL = channelPages(PAGES);
const forge = DIAL.find((p) => p.id === "creator");

/** The rightmost point of the curve, (cx + a, cy), as a percentage of the plate. */
const RIGHT = `${(((GLASS.cx + GLASS.a) / PLATE.width) * 100).toFixed(4).replace(/\.?0+$/, "")}%`;

describe("Glass", () => {
  it("clips every layer to the glass superellipse in plate percentages", () => {
    const html = renderToString(<Glass daemon="online" plane="replay" />);
    expect(GLASS_CLIP).toContain(RIGHT);
    expect(html).toContain("clip-path:polygon(");
    expect(html).toContain(RIGHT);
    // One clip: the picture, the grade, the glare and the lower third all sit inside it.
    expect(html.match(/clip-path:/g)).toHaveLength(1);
    const clip = html.indexOf("clip-path:");
    for (const marker of ['role="img"', "_tint", "_glare", "_rim", "data-lower-third"]) {
      expect(html.indexOf(marker)).toBeGreaterThan(clip);
    }
  });

  it("frames the rig square on the glass, overhanging only at the bottom", () => {
    expect(PICTURE.x).toBeLessThanOrEqual(GLASS.cx - GLASS.a);
    expect(PICTURE.x + PICTURE.size).toBeGreaterThanOrEqual(GLASS.cx + GLASS.a);
    expect(PICTURE.y).toBeLessThanOrEqual(GLASS.cy - GLASS.b);
    expect(PICTURE.y + PICTURE.size).toBeGreaterThan(GLASS.cy + GLASS.b);
  });

  it("names the picture for assistive tech and defers the renderer until after load", () => {
    const html = renderToString(<Glass daemon="online" plane="replay" />);
    expect(html).toContain(`aria-label="The set&#x27;s picture: ${RESIDENT} on air (stylised, live rig)"`);
    expect(html).not.toContain("data-avatar");
  });

  it("puts the user's character on air instead of Malakor (requirement 3.5)", () => {
    const imported = importLegacyLayers(layersJson, specJson);
    if (!imported.ok) throw new Error("the committed rig must import");
    const rig = imported.value.rig;
    const character: OnAirCharacter = { name: "Lantern Warden", rig, look: defaultLook(rig), assets: {} };
    const html = renderToString(<Glass daemon="online" plane="replay" character={character} />);
    expect(html).toContain("LIVE · Lantern Warden");
    expect(html).not.toContain(RESIDENT);
  });

  it("hides the lower third under a hovered channel, and writes no channel once the daemon is lost", () => {
    const hovered = renderToString(<Glass daemon="online" plane="replay" hover={forge} />);
    expect(hovered).toContain("data-hover");
    expect(hovered).toContain("data-glass-caption");
    const lost = renderToString(<Glass daemon="dark" plane="replay" hover={forge} />);
    expect(lost).not.toContain("data-glass-caption");
    expect(lost).toContain("data-no-carrier");
  });
});

describe("LowerThird", () => {
  it("reads LIVE · <character> and one line while there is a picture", () => {
    const html = renderToString(<LowerThird daemon="online" plane="replay" name={RESIDENT} />);
    expect(html).toContain("LIVE · Arch-Lich Malakor");
    expect(html).toContain("you are the only viewer");
  });

  it("is NO CARRIER on dead glass, and says how to re-seat only on replay", () => {
    expect(renderToString(<LowerThird daemon="dark" plane="replay" name={RESIDENT} />)).toContain("Press D to re-seat the daemon");
    const live = renderToString(<LowerThird daemon="dark" plane="live" name={RESIDENT} />);
    expect(live).toContain("NO CARRIER");
    expect(live).toContain("Waiting for the daemon to return");
  });

  it("is gone while the picture folds or relights", () => {
    expect(renderToString(<LowerThird daemon="folding" plane="replay" name={RESIDENT} />)).toBe("");
    expect(renderToString(<LowerThird daemon="relighting" plane="replay" name={RESIDENT} />)).toBe("");
  });
});

describe("GlassCaption", () => {
  it("writes the hovered channel's number, name and subtitle on the glass", () => {
    expect(forge).toBeDefined();
    if (!forge) return;
    const html = renderToString(<GlassCaption page={forge} />);
    expect(html).toContain("data-glass-caption");
    expect(html).toContain("Channel 3");
    expect(html).toContain(">FORGE</text>");
    expect(html).toContain("behind the back panel");
  });

  it("renders nothing without a channel", () => {
    expect(renderToString(<GlassCaption />)).toBe("");
  });
});
