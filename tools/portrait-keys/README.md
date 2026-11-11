# portrait-keys

The portrait builder of companion-lanes (`.kiro/specs/companion-lanes/design.md`, "Builder"): a
1024 px portrait, its aligned image edits (one thing changed each) and a recipe in; soft-matted
layers, a morph-key atlas, a motion image, a sway map, `job.json` (a rig that validates) and
`report.json` (every gate figure) out. Python 3.12 with `requirements.txt` (numpy, OpenCV, Pillow);
no venv is needed when those are installed (else `uv venv tools/portrait-keys/.venv` and install
there and add it to `.gitignore` beside the lab-voice venv).

## Commands

```
# raw 1254 px PNGs (in var/, never committed) -> a character folder
python tools/portrait-keys/build.py import --portrait <concept.png> --edits <dir of <name>/out.png> \
    --noop <noop/out.png> --out assets/characters/companions/<slug>

# a character folder -> a built folder (+ review sheets)
python tools/portrait-keys/build.py build assets/characters/companions/<slug> \
    --out assets/replay/companions/<slug> [--sheets var/companion-lanes/sheets/<slug>]

node scripts/build-packs.mjs          # packs the built folder into apps/web/public/packs/
```

The build reads only the character folder and writes the same bytes on every run (OpenCV runs on
one thread). A refused key fails the build unless the recipe marks it `optional`; `report.json` is
written either way.

## Character folder
- `portrait.png` (1024 x 1024), `edits/<name>.webp` (area-resized to 1024, WebP q92; `matte` =
  figure on #00FF00, `head` = head only on #00FF00, `noop` = the editor's no-op re-render, the noise
  floor), `recipe.json`, `NOTES.md` (measurements, decisions, what the sheets showed, refused keys).

## recipe.json
```
{ id, name,
  eyes: [[x, y], [x, y]],            // pupil centres, picture-left first (the morph's eyes)
  irisRadius,                         // px, for the gaze translation
  openings: [[cx, cy, rx, ry], [..]], // each eye's opening (white + iris): where a gaze translation acts
  faceSplitY, faceSplitBand?,         // round 3: the cheek line; expression keys split into _upper / _lower
  mouth: { cx, lineY, width },        // Rig.mouth
  regions: { <name>: { ellipses: [[cx, cy, rx, ry], ...] } | { box: [x, y, w, h] } },
  mattes: { figure: "matte", head: "head" }, floor: "noop",
  keys: [{ id, track, at?, edit, region, flow: "optical" | "iris" | "none", optional? }],
  sway?: { amp, inner: [cx, cy, rx, ry], reach, gamma, zero?: [region], cap?: [region + max], boost?: [region + min], margin? },
  gates?: { cornerShift, outsideMargin, floorTimes, floorMin, moves, flowSigma, flowFrom, revealTimes, revealRamp, gazeReach, weight1 },
  matte?: { lo, hi, core, nearBody, under, groundCheck, headOnly: [region] },
  recolour?: { <layer>: [{ id, name, minArea?, parts: [{ within?, without?, colour?, except? }] }] },  // see regions.py
  layerQuality?, atlasQuality?,       // WebP quality, default 95
  rig: { palette, anchors: { head: [x, y], body: [x, y] }, face, turn },
  inspect: [[x, y, w, h], ...],       // 2x zoom boxes on the layer sheets (hair ends, jaw, headgear)
  seam: [x, y, w, h], faceBox: [x, y, w, h] }
```
Key ids match `[a-z0-9_]+` (`open_mid`); `track` is the MorphTrack name (`openMid`). Every region
is measured on that character's own portrait: never copy one character's numbers to another.

`flow`: `optical` is DIS (medium, finest scale 1) both ways with a forward-backward check, smoothed
(`flowSigma`); with `flowFrom: "back"` the forward field F is the inverse of the back field G (one
motion both ways); `iris` is one translation per eye (the portrait's iris disc found in the edit
along the track's direction), over the eye's `openings` ellipse; `none` is a plain cross-fade. Pick
per key by looking at its strip. Round 2 (design "Round 2 amendment"): every moving key writes F
(`flowCell`) and G plus reveal (`backCell`) unscaled; the shader needs no inversion.

## Steps and gates (report.json)
1. Mattes: soft alpha from the green edits (a projection keyer, pockets filled, then a ground check
   against the portrait where figure and ground differ in colour); colour from the portrait un-mixed
   against its ground; head / body split by the head edit near the body; the body pushed 40 px
   (`under`) under the head; layers cropped to alpha + 4 px, WebP q92. Figures: each matte edit's
   affine and corner shift, `recomposeMeanAbs` / `recomposeP99` (head over body over ground vs the
   portrait, /255), `groundCheckLowered`.
2. Per key: ECC affine registration (half size, the region masked out); refused when a corner moves
   more than `cornerShift` px, or when the mean difference outside the region (inside the figure)
   exceeds the floor's by `outsideMargin` /255. Support: difference above `floorTimes` x the floor's
   local level (at least `floorMin`), or motion above `moves` px; dilated 10, feathered 8, times
   the region prior (feathered 10) and the head alpha. `supportPx`.
3. Motion: see `flow`. The key's coverage is widened to hold its own motion, and both fields fade
   to 0 with it and inside the head's silhouette (16 px). Reveal: where the key differs from the
   layer pixel its back motion leads to, in floor levels (`revealMean`). Where nothing moves and
   the edit is within the editor's noise of the portrait, the key is the portrait (no halo).
4. Colour match: the low-frequency residual (portrait - edit) outside the support, extended across
   it, added to the key (`colourShift`).
5. Atlas (WebP, at most 2048 square, 2 px gutters) and motion image (PNG, 1/4 size cells, 1 px
   gutters), shelf-packed; `weight1`: the shader's math on the written files at weight 1 against
   the key inside its coverage (/255), refused above the gate; `sharpness` (Laplacian variance of
   the decoded cell over the key's colour; the head layer's over the portrait in `faceBox`).
   Expression keys with `faceSplitY` become `<id>_upper` and `<id>_lower` (`part`), a partition of
   the whole key by a smoothstep band; `composedWeight1` checks both parts together.
   Regions (`recolour`): an index map per layer, `<layer>.regions.png` (see regions.py).
6. Sheets (`--sheets`): `layer-head.jpg` / `layer-body.jpg` (over magenta, white, black, 2x zooms),
   `seam.jpg` (head moved 6, 4 px), `key-<id>.jpg` (weights 0-1; with motion, the plain cross-fade
   below), `track-blink.jpg` (the stop rule), `contact.jpg`, `sway.jpg`, `regions-<layer>.jpg`.

## Adding a character
Generate the edits (the prompts are in `var/companion-lanes/keys/make.py` and the Director's
`prompt.txt` files), `import` them, measure eyes, iris radius, mouth and regions on a grid overlay
of the portrait, write `recipe.json`, `build --sheets`, look at every sheet, set each key's `flow`,
write `NOTES.md`, add a provenance row per committed image, and add a voice in
`scripts/build-packs.mjs` `COMPANION_VOICES`.
