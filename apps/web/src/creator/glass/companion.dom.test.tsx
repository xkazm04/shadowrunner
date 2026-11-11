// @vitest-environment happy-dom
// companion-lanes requirement 6.3 in the creator: on a morph rig (Iris, Bun: one head repainted by
// keys, no eye, iris, jaw or emissive layer) a light that cannot reach anything is not shown, neither
// as a chip nor as a pin on the glass, and the six expression families the keys paint read Painted
// and can be retired (the morph plan honours a retired family). A rig without `morph` keeps all four
// lights and its families exactly as before.
import { defaultLook, EXPRESSION_FAMILIES, type Rig } from "@sr/rig";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { testRig } from "../testFixtures";
import { FACE_GROUPS, FaceCard, faceRows } from "./FaceCard";
import { FaceFamilies, familyStates } from "./FaceFamilies";
import { PaletteCard } from "./PaletteCard";
import { lightApplies, lightPins } from "./pins";

/** A companion-shaped rig: background plate, body, head; morph keys on every family, blink, a mouth shape and a gaze. */
export function morphRig(): Rig {
  return {
    version: 1,
    id: "companion",
    name: "Companion",
    width: 1024,
    height: 1024,
    source: "replay",
    fictional: true,
    palette: { glow: "#5fd6e8", eye: "#7f9bb0", rim: "#000000", mouth: "#b8686e" },
    mouth: { cx: 515, lineY: 512, width: 118 },
    layers: [
      { name: "background", z: 1, kind: "static", file: "background.webp", bbox: [0, 0, 1024, 1024], anchor: [512, 1024] },
      { name: "body", z: 2, kind: "body", file: "body.webp", bbox: [37, 510, 946, 514], anchor: [512, 1024] },
      { name: "head", z: 3, kind: "head", file: "head.webp", bbox: [228, 16, 555, 601], anchor: [512, 600] },
    ],
    morph: {
      layer: "head",
      atlas: "atlas.webp",
      keys: [
        ...EXPRESSION_FAMILIES.map((family, i) => ({ id: family, track: family, bbox: [300, 200, 400, 400] as [number, number, number, number], cell: [0, i * 10, 10, 10] as [number, number, number, number] })),
        { id: "blink", track: "blink", bbox: [400, 320, 220, 60], cell: [20, 0, 10, 10] },
        { id: "open_wide", track: "openWide", bbox: [450, 470, 130, 90], cell: [30, 0, 10, 10] },
        { id: "gaze_l", track: "gazeL", bbox: [400, 320, 220, 60], cell: [40, 0, 10, 10] },
      ],
      eyes: [
        [437, 346],
        [589, 345],
      ],
    },
  };
}

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

const chips = (v: Mounted): string[] => [...v.container.querySelectorAll("[data-chip]")].map((c) => c.getAttribute("data-chip") ?? "");

describe("lights on a morph rig", () => {
  it("only the rim applies: no eye or iris layer, no layer that gives light, no mouth-light region", () => {
    const rig = morphRig();
    expect((["eye", "glow", "rim", "mouth"] as const).filter((key) => lightApplies(rig, key))).toEqual(["rim"]);
    expect(lightPins(rig).map((p) => p.key)).toEqual(["rim"]);
  });

  it("an eye layer or an emissive layer brings its light back; a rig without morph keeps all four pins", () => {
    const rig = morphRig();
    const withEye: Rig = { ...rig, layers: [...rig.layers, { name: "eye_l", z: 4, kind: "eye", file: "eye.webp", bbox: [420, 330, 40, 30], anchor: [440, 345] }] };
    expect(lightApplies(withEye, "eye")).toBe(true);
    expect(lightApplies(withEye, "glow")).toBe(true); // an unsocketed eye gives light
    const plain = testRig();
    expect(lightPins(plain).map((p) => p.key).sort()).toEqual(["eye", "glow", "mouth", "rim"]);
  });

  it("the Palette card shows the rim chip alone and no mouth-light note", async () => {
    const rig = morphRig();
    const look = defaultLook(rig);
    view = await mount(<PaletteCard rig={rig} palette={look.palette} regions={look.regions} onPalette={() => undefined} onRegion={() => undefined} />);
    expect(chips(view)).toEqual(["light:rim"]);
    expect(view.container.textContent).not.toContain("no mouth light");
  });

  it("a cast rig's Palette card is unchanged: four chips, the mouth chip disabled with its note", async () => {
    const rig = testRig();
    const look = defaultLook(rig);
    view = await mount(<PaletteCard rig={rig} palette={look.palette} regions={look.regions} onPalette={() => undefined} onRegion={() => undefined} />);
    expect(chips(view)).toEqual(["light:eye", "light:glow", "light:rim", "light:mouth"]);
    expect(view.container.querySelector<HTMLButtonElement>('[data-chip="light:mouth"]')?.disabled).toBe(true);
    expect(view.container.textContent).toContain("no mouth light");
  });
});

describe("the Face card on a morph rig", () => {
  it("hides mouth emotion (the keys take the emotion-free mix) and keeps every other row; a cast rig keeps it", async () => {
    view = await mount(<FaceCard rig={morphRig()} face={undefined} onFace={() => undefined} onReset={() => undefined} lookAround={false} onLookAround={() => undefined} reduced={false} />);
    const fields = [...view.container.querySelectorAll("[data-face]")].map((e) => e.getAttribute("data-face"));
    expect(fields).not.toContain("mouth.emotion");
    expect(fields).toHaveLength(FACE_GROUPS.flatMap((g) => g.rows).length - 1);
    const expression = FACE_GROUPS.find((g) => g.id === "expression");
    if (expression === undefined) throw new Error("no expression group");
    expect(faceRows(expression, testRig()).map((r) => r.field)).toContain("mouth.emotion");
  });
});

describe("FACES on a morph rig", () => {
  it("every family with a key on its track is Painted, and a retired one reads retired", () => {
    const rig = morphRig();
    expect(Object.values(familyStates(rig, {}))).toEqual(EXPRESSION_FAMILIES.map(() => "painted"));
    expect(familyStates(rig, { face: { expression: { faces: { anger: "procedural" } } } }).anger).toBe("retired");
    const { morph } = rig;
    if (morph === undefined) throw new Error("no morph");
    const partial: Rig = { ...rig, morph: { ...morph, keys: morph.keys.filter((k) => k.track !== "gloom") } };
    expect(familyStates(partial, {}).gloom).toBe("none");
    expect(familyStates(testRig(), {}).joy).toBe("none");
  });

  it("offers Retire on each painted family", async () => {
    const retired: string[] = [];
    view = await mount(<FaceFamilies rig={morphRig()} retired={undefined} onRetire={(family) => retired.push(family)} preview={undefined} onShow={() => undefined} reduced={false} />);
    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("[data-retire]")];
    expect(buttons.map((b) => b.disabled)).toEqual(EXPRESSION_FAMILIES.map(() => false));
    buttons[0]?.click();
    expect(retired).toEqual(["joy"]);
    expect(view.container.querySelector("[data-families-note]")).toBeNull();
  });
});
