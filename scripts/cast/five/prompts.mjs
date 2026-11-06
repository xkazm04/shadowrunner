// Material-specific edit prompts for the non-human five (cast-face-pass, WP1b). The shared strict
// prompt (forge expressionPrompt) speaks of brows, eyelids, irises and pupils: on a void skull, a
// carved pumpkin, a neon clock, a steel helm or a stained-glass fish Codex then paints human eyes
// (every old face of these five did). Each character's prompt names its own eye material, what may
// move (socket rims, carved edges, clock hands, visor slits, lead-framed panes) and what must never
// be added (eyeballs, irises, pupils, lids, lashes, skin) or touched (the mouth). Cast only, no model.

/** Per character: how its eyes, brows and mouth are made, and the face of each family in that material. */
export const FIVE = {
  "announcer-of-dead-air": {
    name: "the Announcer of Dead Air",
    eyes: "two round orbs of purple-white light floating inside two black hollow eye sockets of a dark void skull",
    keepEyes: "Keep both glowing orbs exactly where they are, the same size, colour and brightness: they are lights, not eyes, so never draw eyeballs, irises, pupils, eyelids, lashes or skin around them.",
    mouth: "the grin of white teeth and the black gap between the teeth rows",
    faces: {
      joy: "warm delight: the bone under each eye socket lifted into soft happy crescents that curve up under the lights, the brow ridges raised and soft",
      showman: "a theatrical flourish: the bony socket rims opened wide and round around the lights, the brow ridges high and arched",
      anger: "fury: the bony brow ridges drawn down hard into a V with a deep crease of bone between them, the upper socket rims lowered into a glare that cuts across the top of the lights",
      gloom: "gloom: the brow ridges heavy and low with their inner ends lifted, the upper socket rims lowered over the top third of the lights",
      smug: "smug superiority: one brow ridge raised high, the upper socket rims half lowered over the lights",
      suspicion: "suspicion: the socket rims narrowed from above and below around the lights, one brow ridge lowered",
    },
  },
  "lantern-warden": {
    name: "the Lantern Warden",
    eyes: "two triangular eye holes carved into a weathered jack-o'-lantern pumpkin, lit from inside by a candle (a warm yellow hot spot low in each hole)",
    keepEyes: "Keep the candle light inside each hole exactly where it is, the same size, colour and brightness. These are carved holes, not eyes: never draw eyeballs, irises, pupils, eyelids, lashes, skin or a face inside them.",
    mouth: "the carved jagged grin, its square teeth and the dark gap",
    faces: {
      joy: "warm delight: the bottom edges of both carved eye holes recut into upward curves so the holes read as happy crescents, with a short carved brow notch raised above each hole",
      showman: "a theatrical flourish: both carved eye holes recut taller and wider with high arched tops, a carved arched brow notch above each",
      anger: "fury: the top edges of both carved eye holes recut into steep slants down toward the nose so the holes glare, with a deep carved brow gash slanting into a V above them",
      gloom: "gloom: the top edges of both carved eye holes recut flat and low so the holes are short and heavy-lidded, the inner corners lifted, a flat carved brow notch above each",
      smug: "smug superiority: one carved eye hole recut with a high arched top and a raised carved brow notch, the other recut with a flat lowered top edge",
      suspicion: "suspicion: both carved eye holes recut narrower from the top, one with a lowered slanted carved brow gash",
    },
  },
  reveille: {
    name: "Reveille",
    eyes: "two glowing cyan neon rings on the cream dial of a brass alarm clock, with the two black clock hands lying above them as brows",
    keepEyes: "Keep both neon rings centred exactly where they are, drawn as the same glowing cyan neon tube: they are neon lights, not eyes, so never draw eyeballs, irises, pupils, eyelids, lashes or skin, and nothing inside the rings but the dark dial.",
    mouth: "the hinged dial jaw, the cyan zigzag teeth and the dark gap",
    faces: {
      joy: "warm delight: both neon rings bent into upward arcs like happy crescents, the clock-hand brows raised and curved",
      showman: "a theatrical flourish: the neon rings wide and round, the clock-hand brows high and arched",
      anger: "fury: the two black clock-hand brows swung down hard into a steep V pointing to the crack between the eyes, and the tops of both neon rings flattened into a glare (each ring a flattened neon oval, same centre)",
      gloom: "gloom: only the lower arcs of the neon rings lit, the clock-hand brows flat and low",
      smug: "smug superiority: one clock-hand brow raised high, the other flat, the tops of the rings flattened",
      suspicion: "suspicion: the left clock-hand brow lowered and slanted down toward the centre, the right one level, and both neon rings squeezed into narrower flattened neon ovals around the same centres (the same neon tube, still empty inside)",
    },
  },
  "sir-vacant": {
    name: "Sir Vacant",
    eyes: "two narrow horizontal eye slits cut in the visor of a weathered pewter great-helm, star-white light shining through them from the empty helm",
    keepEyes: "The slits are holes in steel with light behind them: never draw eyeballs, irises, pupils, eyelids, lashes, brows or skin, only the steel visor plate and its slit openings with the same flat star-white light.",
    mouth: "the bevor plate, its white light gap and its vertical breathing slots",
    faces: {
      joy: "warm delight: the lower edges of both visor slits bent upward in the middle so each slit reads as a happy upward crescent of white light",
      showman: "a theatrical flourish: both visor slits opened taller, the steel above and below each slit pushed back so more white light shows",
      anger: "fury: both visor slits tilted down toward the centre of the helm into a V, each slit a narrow slanted wedge, thicker at the outer end",
      gloom: "gloom: both visor slits narrowed from the top into thin drooping lines of light, their outer ends lower",
      smug: "smug superiority: one visor slit narrowed from the top to a thin line, the other left open",
      suspicion: "suspicion: both visor slits narrowed into thin lines of light, the left one slanted down toward the centre",
    },
  },
  "vicar-of-the-lure": {
    name: "the Vicar of the Lure",
    eyes: "two small round milky-white glass eye discs framed by black lead lines on the stained-glass head of a deep-sea anglerfish",
    keepEyes: "Keep both milky glass eye discs where they are, the same plain milky glass: they are glass panes, so never draw eyeballs, irises, pupils, eyelids, lashes or skin; anything that covers them is a pane of the same blue stained glass with a black lead line along its edge.",
    mouth: "the huge open maw, its glassy needle teeth, the magenta throat and the lower jaw",
    faces: {
      joy: "warm delight: a curved lead-framed pane of blue glass rising under each eye disc like a happy crescent cheek, and the glass brow ridges above the eyes lifted into arches",
      showman: "a theatrical flourish: the glass brow ridges above the eyes lifted high and arched, their lead lines curving up",
      anger: "fury: the glass brow ridges above the eyes pulled down into a steep V, a lead-framed blue pane covering the top third of each eye disc in a slant down toward the centre",
      gloom: "gloom: a lead-framed blue glass pane lowered over the top half of each eye disc, the glass brow ridges flat and low",
      smug: "smug superiority: one glass brow ridge lifted high, a lead-framed blue pane half lowered over the other eye disc",
      suspicion: "suspicion: lead-framed blue panes narrowing each eye disc from above and below, one glass brow ridge lowered",
    },
  },
};

/** The strict frame for one family: only the eye band changes, in the character's own material. */
export function facePrompt(slug, family, attempt = 0, style) {
  const c = FIVE[slug];
  const frame = `Edit this portrait of ${c.name}. Its eyes are ${c.eyes}. Change ONLY the area around the eyes, to ${c.faces[family]}. ${c.keepEyes} Keep the structure of the face exactly: the same head shape, outline and proportions. Do not change ${c.mouth} in any way: the mouth stays exactly as painted, pixel for pixel. Keep the same character, pose, framing, art style, colours, lighting, background and every other pixel. Do not add or remove objects.`;
  const stricter = [
    "Only the shapes directly around the eyes may change: every pixel below the eyes and above the brow line stays identical, and the lights do not move by even one pixel.",
    "This is a tiny retouch, not a repaint: leave the forehead, the cheeks, the mouth and the outline of the head untouched and redraw nothing outside the eye area.",
  ].slice(0, attempt).join(" ");
  const strict = stricter === "" ? frame : `${frame} ${stricter}`;
  return style === undefined ? strict : `${strict} The art style is ${style}.`;
}

/** The closed-eye edits (a blink crossfades to them); characters whose plate already reads as closed have none. */
export const CLOSED = {
  "lantern-warden":
    "Edit this portrait of the Lantern Warden, a carved jack-o'-lantern. The candle inside has gone out behind the eyes: both triangular carved eye holes now show only the dark unlit hollow inside of the pumpkin, deep brown-black shadow with only a faint dull orange on the cut edges of the rind, no flame and no glow in the eye holes. Keep the exact shape, size and position of both carved eye holes, and every other pixel of the image exactly as it is, including the glowing carved mouth.",
  reveille:
    "Edit this portrait of Reveille, a neon alarm clock. Switch off the upper part of both cyan neon ring eyes: each eye becomes only the lower arc of its ring (the bottom third of the circle, a short upward-open curve like a closed sleeping eye), the same glowing cyan neon tube at the same place, and the rest of each ring dark and gone, showing only the cream dial there. Draw no eyelids, no lashes, no eyeballs. Keep the clock-hand brows, the dial, the teeth and every other pixel of the image exactly as it is.",
  "vicar-of-the-lure":
    "Edit this portrait of the Vicar of the Lure, a stained-glass anglerfish. Close both eyes in stained glass: cover each round milky-white glass eye disc completely with a rounded pane of the same deep blue stained glass as the scales around it, its texture matching them, with a black lead line across the middle of the disc where the closed lid meets, and keep the black lead ring around each disc. Draw no eyelids of skin, no lashes, no eyeballs. Keep every other pixel of the image exactly as it is, including the open maw and teeth.",
};

/** A no-op edit: the same editor re-rendering the same portrait gives the outside-band noise floor. */
export const NOOP = "Return this exact image unchanged: reproduce it identically, every shape, colour and pixel the same, the same size and framing. Do not change anything.";

/** Lantern Warden: a mask edit of one face edit: its recut eye holes' openings (a face's sockets). */
export const HOLES = "Edit this image into a mask for an animator. In both carved eye holes of the pumpkin (not the nose and not the mouth), paint everything you can see through the cut opening (the lit inside of the pumpkin and the candle light) solid flat pure green #00FF00, right up to the cut edge of the rind. Do not paint the rind, the carved edges, the brow notches, the nose, the mouth or anything else. Keep every other pixel of the image exactly as it is, the same size and framing.";
