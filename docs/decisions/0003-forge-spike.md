# 0003: Forge spike on fresh portraits

- **Status:** final (2026-11-01). Run 1 (portrait and parts only) and run 2 (end to end, after
  forge-pipeline tasks 3-7) are both recorded below. Run 2 decides requirement 1.3.
- **Spec:** forge-pipeline requirement 1, task 1.
- **Run 1:** 2026-11-01 13:15 UTC, one pass, no retries needed. Portraits from `gemini-3-pro-image`
  (`portraitPrompt`), parts from `gemini-3.8-flash` (`PARTS_PROMPT`, `responseMimeType:
  application/json`). Client timeout 120 s, so the timings below are true latency.
- **Prompts:** presets 1, 3 and 5 from `assets/characters/presets/PROMPTS.md` (351-377 characters,
  so none was cut by the 400-character limit).
- **Run 1 outputs** (git-ignored): first in `var/forge-spike/`, now kept in
  `var/forge-spike-20261101-1315/` because run 2 writes to `var/forge-spike/`: `summary.json`,
  and per portrait `prompt.txt`, `portrait.jpg`, `parts.raw.txt`, `parts.json`, `check.json`,
  `overlay.svg`, `overlay.png`. The three run-1 portraits are committed as replay jobs in
  `assets/replay/forge/<slug>/portrait.jpg` (task 8).

## Run 1 results (portrait and parts)

| Portrait | Portrait step | Parts step | Total | Parts (valid / returned) | Expected parts found | Rig (run 1) | Overlay |
|---|---|---|---|---|---|---|---|
| Lantern Warden (preset 1) | 15.0 s | 17.1 s | 32.0 s | 6 / 6 | 6 of 6 (head, jaw, eye_l, eye_r, hat, torso) | valid, built offline in task 8 (`assets/replay/forge/lantern-warden/`, fill fallback) | `var/forge-spike-20261101-1315/lantern-warden/overlay.png` |
| The Understudy (preset 3) | 15.4 s | 13.7 s | 29.1 s | 6 / 6 | 6 of 6 (head, jaw, eye_l, eye_r, accessory, torso) | valid, built offline in task 8 (fill fallback) | `var/forge-spike-20261101-1315/understudy/overlay.png` |
| Announcer of Dead Air (preset 5) | 15.9 s | 19.6 s | 35.6 s | 7 / 7 | 7 of 7 (head, jaw, eye_l, eye_r, hat, crown, torso) | valid, built offline in task 8 (fill fallback) | `var/forge-spike-20261101-1315/announcer-of-dead-air/overlay.png` |

"Valid" means the requirement 3.2/3.3 checks pass: names from the closed list, integer coordinates
in 0..1000, `box_2d` has 4 values, `poly` has 3..60 points, `head` is present, and no name repeats.
Every call succeeded on the first attempt, and every one finished inside the 55 s server timeout.
Each portrait is 1024x1024.

Overlay colours: head red, jaw yellow, eye_l blue, eye_r cyan, hat orange, crown pink,
accessory white, torso green. Each `overlay.svg` is the same picture with part labels.

## Part quality (by eye, from the overlays)
- **Lantern Warden:** good. The eyes are tight triangles (4 points each, below the 8 the prompt
  asks for, but still inside 3..60). The jaw follows the carved teeth. The hat covers most of the brim
  and overlaps the top of the gourd, which is correct because the hat is in front there. The torso
  leaves out part of the left shoulder.
- **The Understudy:** usable. The eyes and the hinged jaw are clean, and this portrait gives the
  best lip-sync jaw of the three. The head polygon crosses itself near the crown and leaves out most
  of the cranium above the ribbon. It also leaves out the ears. The accessory (ribbon and bell)
  polygon crosses itself as well.
- **Announcer of Dead Air:** good. The crown (24 points) follows the antenna ring closely. The eyes are
  tight circles. The hood came back as `hat`, and its polygon contains the whole face.

Of the 19 polygons, 5 cross themselves once each: Lantern hat and torso, Understudy head and
accessory, Announcer crown and torso.

## Findings for later tasks
These come from measurement. They do not change the spec. Each one is raised for the owner to
decide.
1. **The portraits are JPEG.** `gemini-3-pro-image` returned `image/jpeg` all 3 times. design.md
   plans `png.ts` on `upng-js`, which decodes PNG only. Task 2.1 needs either a PNG output setting
   on the image call (not tested here) or a pure-JS JPEG decoder (for example `jpeg-js`) behind
   `decodePng`/`decodeImage`.
2. **The background is darker than black but not `#050505`.** Background luma, measured on 40 px
   corner and edge patches: Lantern mean 7.7-12.8 (max 16), Understudy 6.8-10.3 (max 14), Announcer
   11.2 (max 14). With `lumaKey(lo=10, hi=28)`, much of that ground would stay 5-20% opaque in the
   crown, hair and accessory layers and show as haze. A `lo` near 16, or a `lo` measured per
   portrait from its corners, would key it out.
3. **Polygons cross themselves.** `rasterizeMask` should use the non-zero winding rule. With
   even-odd, the Understudy's cranium would drop out of the head layer.
4. **Hood versus hat cut order.** The design cuts `hat` before `head`. For a hood (Announcer), the
   hat polygon contains the face, so the hat layer would take the face pixels and the head layer
   would be nearly empty. Possible fixes: cut `head` before `hat`, or subtract the head polygon
   from `hat` whenever the head lies inside the hat. Task 3 should test this case.

Run 1's provisional decision was to keep polygons on part quality alone, because requirement 1.3
is about valid rigs and cut and assemble did not exist yet. Findings 1-4 were handled by the
director rulings in tasks 2-4.

## Run 2: end to end (task 1.2)
- **Run:** 2026-11-01 15:58 UTC, `node scripts/forge-spike.mjs`, one pass, no retries. The script
  now drives the server code itself: `api/_lib/forge-steps.ts` with the `api/_lib/gemini.ts`
  client, the server timeouts (55 s per call, 30 s for the fill edit), a memory job store and no
  quota. The steps are portrait, parts, fill edit, cut and assemble. Models: `gemini-3-pro-image`
  for the portrait and the fill edit, and `gemini-3.8-flash` for the parts. The run made 9 paid
  calls (3 portraits, 3 parts, 3 fill edits). Each one succeeded on the first attempt, inside its timeout.
- **New portraits:** the same 3 preset prompts, generated again, so they differ from run 1
  (sha256 `29cbd8a8...`, `b13485be...`, `24082a46...`). All 3 are 1024x1024 JPEG.
- **Outputs (git-ignored):** `var/forge-spike/summary.json`, and per portrait `portrait.jpg`,
  `parts.raw.txt`, `parts.json`, `overlay.png`, `plate.jpg` (the fill edit), `rig.json`,
  `layer-*.png` and `composite.png`. The composite shows the portrait, the layers composited, and
  the layers with the jaw moved down 31 px (3% of the height). A downscaled copy of the 3
  composites is committed as `docs/decisions/0003-forge-spike-composites.jpg`, one row per portrait.

| Portrait | Portrait | Parts | Fill edit | Cut + assemble | Total | Parts returned | Expected parts found | Fill | validateRig | Layers | Composite |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lantern Warden (preset 1) | 17.3 s | 17.9 s | 16.7 s | 1.9 s | 54.3 s | 6 | 6 of 6 | edit | ok | 7: background, torso, head, jaw, hat, eye_r, eye_l | `var/forge-spike/lantern-warden/composite.png` |
| The Understudy (preset 3) | 18.0 s | 11.7 s | 18.1 s | 1.5 s | 50.0 s | 6 | 6 of 6 | edit | ok | 7: background, torso, head, jaw, accessory, eye_r, eye_l | `var/forge-spike/understudy/composite.png` |
| Announcer of Dead Air (preset 5) | 16.3 s | 11.9 s | 15.8 s | 1.6 s | 46.1 s | 7 | 6 of 7 (the antenna ring came back as `accessory`, not `crown`) | edit | ok | 8: background, torso, head, jaw, hat, accessory, eye_r, eye_l | `var/forge-spike/announcer-of-dead-air/composite.png` |

Every parts reply parsed as JSON on the first ask, so no re-ask was needed. Every step fit well
inside one 60 s function invocation: the longest single GET took 18.4 s (the Understudy fill edit).
The step columns come from the server's own `timings`. The totals are wall time.

### What the composites show (inspected by eye)
- **The faces work.** Eyes, jaw, hat and the Announcer's ring sit where they belong. Each composite
  reads as the same character as its portrait.
- **Box edge around the jaw (task 7 note).** There is no rectangular (bbox) edge. The plate-sourced
  head is painted exactly over the jaw polygon, never over the jaw's bounding box. I checked this by
  drawing the head layer alone, with the jaw bbox and polygon on top. But when the jaw moves, a hard
  edge **does** show in all 3 portraits, and it follows the jaw polygon. The head and jaw polygons do
  not touch (Lantern, Announcer), or they meet along straight seams (Understudy). Nothing covers the
  space outside them. So the opened jaw shows a jaw-shaped painted patch on the head with an empty
  black gap around it. The Understudy's jaw polygon is almost rectangular, so its patch looks like a
  dark box between the two seams. The Announcer's patch is grey skull bone with a straight top edge.
- **Uncovered regions go black.** Anything outside every part polygon is dropped, and the
  `background` layer is a solid near-black ground. This removes the neck and collar (Lantern,
  Understudy), the ears and the sides of the ruff (Understudy), and the microphone-mesh collar
  (Announcer). It shows even with the jaw closed.
- **The fill edit drifts.** The final-model edit redraws more than the lifted parts. On the
  Announcer, the "void of soft darkness" face came back as a visible skull. The head layer is cut
  from that plate, so the rig's face is not the portrait's face. On the Understudy, the edit removed
  the ribbon and bell (the accessory) as asked, but it also changed the cracks and the brow.

## Decision
**Keep polygons. Do not adopt the pose-template fallback.** Requirement 1.3: 3 of 3 fresh portraits
produced a rig that passes `validateRig` (the threshold is 2 of 3). Each found every expected part
and finished end to end in 46-54 s. The 4 replay jobs from task 8 also assemble and validate. They
were built offline from run 1 and Malakor.

The findings above are about rig quality, not validity. They go to the owner for a ruling, with
these counter-proposals:
1. Make the `background` layer the filled plate instead of a solid ground. Every region outside the
   parts then keeps its pixels (neck, collar, ears), and the open jaw shows plate, not black.
2. On the plate-sourced head, grow the lifted jaw region upward until it meets the head polygon (for
   example, use the convex hull of the head and jaw polygons). Also grow it downward by the jaw's
   travel. Then the opened jaw never shows a polygon edge.
3. Guard against fill drift. One option: compare the plate to the portrait outside the lifted parts
   (for example, mean luma difference over the head polygon), and use the `blurExtend` fallback when
   the drift is too large. Another option: cut only the lifted region from the plate and the rest of
   the head from the portrait.

## Task 9: rig quality and the two new presets (2026-11-01)
Director rulings on the run 2 composites (forge-pipeline task 9). What changed in `@sr/forge`:
- **Plate** (`plate.ts` `composePlate`): the portrait everywhere except inside the lifted region
  (`liftedRegion`: the FILL_PARTS polygons, the jaw's grown by `JAW_GROW` = 6 px) dilated by 12 px,
  where the fill (the edit, or `fallbackFill` = `blurExtend` with 24 blur passes) is blended in over
  6 px. Property: outside that region the plate equals the portrait bit for bit.
- **Background** = the whole plate (`assembleRig`), so nothing the parts leave uncovered is black.
- **Rest equals the portrait.** The moving parts (FILL_PARTS) are opaque over their whole lifted
  region and feather 3 px outward; the head carries the plate only inside the lifted region and
  the portrait elsewhere, and covers the plate's whole blend zone; crown/hair/accessory key out a
  pixel only as far as the plate behind it looks the same (`KEY_KEEP` = 8 luma). So no fill pixel
  shows at rest, and the Announcer keeps his void face by construction. Property: for any parts,
  portrait and fill, the rig at rest gives back the portrait within luma 8 at every pixel.
- **Jaw.** The lifted region is grown 6 px so its edge lies past the jaw's outline (the jaw layer is
  grown with it, feathered 3 px outward, top edge included). What an open jaw uncovers is shaded
  as a mouth (`MOUTH_SHADE` 0.25, ramping in over 28 px, deepest mid-width), whatever the fill
  painted there; the fallback's smear of teeth on Malakor now reads as a mouth in shadow.
- `composite.ts` `compositeRig`: a reference compositor (whole-pixel moves) for tests and review.

**Paid run (presets 2 and 4).** 2026-11-01 16:25 UTC, `node scripts/forge-spike.mjs --presets 2,4
--out var/forge-presets`, the server pipeline as in run 2. 6 paid calls (2 portraits, 2 parts, 2
fill edits), all first attempt, no parts re-ask.

| Preset | Portrait | Parts | Fill edit | Parts returned | Expected found | validateRig |
|---|---|---|---|---|---|---|
| Sister Vesper (2) | 15.1 s | 19.8 s | 17.8 s | 6: head, jaw, eye_l, eye_r, hair, torso | 6 of 6 | ok |
| The Moth Widow (4) | 15.2 s | 21.5 s | 15.2 s | 6: head, jaw, eye_l, eye_r, hair, torso | 5 of 6 (antennae came back as `hair`, not `crown`; same layer kind) | ok |

Both fill edits drifted again (Vesper's lower face became a skull, the Moth Widow's face was
removed entirely); with the new plate none of it shows at rest.

**Replay jobs rebuilt offline** (`node scripts/forge-replay.mjs`, no paid call): Malakor (fallback)
and presets 1-5 with their recorded fill edits (run 2 for 1, 3, 5; the run above for 2, 4). The
inputs are committed in `assets/characters/presets/<slug>/` (`portrait.jpg`, `parts.json`,
`fill.jpg`); the jobs replace the task 8 jobs, which were built from run 1 portraits without a fill
edit. Rest composites measured against the portrait: max luma difference 0.0 (Malakor, Lantern,
Vesper, Moth), 1.0 (Understudy), 2.5 (Announcer). Every composite (rest, jaw open 6%, head turned
10 degrees with the jaw half open) was inspected by eye: `var/forge-replay/<slug>.png`.
Before/after grid: `docs/decisions/0003-forge-task9-composites.jpg` (251 KB; "before" is run 2's
composite with the jaw open 3%, "after" the replay job with the jaw open 6%).

**Seen and not fixed:**
- **Ghost edges when the head turns** (fixed in task 10, below). The background is the whole plate, so it still holds the
  head and crown where they were at rest. With the head turned 10 degrees (gaze "chat"), the head
  moves about 11 px and the crown about 12 px, and their edges show a doubled copy (clearest on
  Malakor's crown shards). Idle drift (4 degrees, about 4 px) shows little. Counter-proposal: paint
  the background under the opaque cores of the moving layers (eroded 2 px, so the rest view is
  unchanged) with `blurExtend` from the uncovered surroundings; the regions the parts leave
  uncovered still keep their plate pixels.
- At the full drop (0.06 x height) a small jaw, such as the Moth Widow's chin, travels far and the
  fur the edit painted shows as a dark band a little wider than the mouth.

## Task 10: no ghost edges on head turn (2026-11-01)
Director ruling: adopt the counter-proposal above. `background.ts` `backgroundOf` (used by
`assembleRig`):
- The solid area is every pixel where a moving layer (all but the torso) has alpha >= 96, plus the
  whole polygon of a keyed moving part (crown, hair, accessory). The polygon matters: Malakor's dark
  shard facets fall under the luma key, so they sat in the background and stayed behind as half a
  shard when the crown moved.
- Inside the solid area eroded by 2 px, the background is `blurExtend`ed (12 passes) from the
  surface outside everything the moving layers touch. Painting it from the eroded ring instead
  smeared the head's own edge inward, which reads as another head.
- The rest view is unchanged. Where a painted pixel has no opaque layer over it, the most solid
  moving layer there is made opaque with the colour the plate and the layers behind it showed.
  Rest composites against the portrait: max luma difference 0.0 (Malakor, Lantern, Vesper, Moth),
  1.0 (Understudy), 2.5 (Announcer), as in task 9.

**Golden** (`api/_tests/forge-replay-turn.test.ts`): each committed replay job is posed through
`poseLayers` at the gaze "chat" yaw (10 degrees, no gesture). In the strip the head, crown and hat
vacate, the test counts pixels where the turned picture repeats the rest picture within 6 luma,
counting only pixels that stand out from the ground by more than 16. The task 9 jobs score
0.90-1.00, and the test was run red against them. The task 10 jobs score 0.19-0.40, under the
limit of 0.5. What remains is the 2 px erosion band and the soft edge, an echo a few px wide that
did not show by eye. All 6 jobs were rebuilt offline (no paid call). Grid:
`docs/decisions/0003-forge-task10-composites.jpg` (345 KB). Columns: portrait, rest, jaw open 6%,
then task 9 and task 10 with the head turned 10 degrees and the jaw half open, zoomed.

## Malakor parts-only run (fixture `m8-parts.json`)
Director ruling (a) of the task 2 review: the parts fixture for the Malakor golden test is a
recorded response, not a tracing. On 2026-11-01 14:18 UTC the spike ran once as
`node scripts/forge-spike.mjs --parts-only assets/characters/malakor/rig/portrait.png`. That is one
`gemini-3.8-flash` call (`PARTS_PROMPT`, `responseMimeType: application/json`, first attempt
succeeded) on the committed 1024x1024 PNG (sha256 `c215283f...bd02989`).

- **Timing:** 17.3 s (the 2026-10-31 probe took 20.4 s). Tokens: 1,247 in (1,089 image), 1,584 out,
  547 of them thinking.
- **Parts:** 7. They are crown (36 points), head (24), jaw (17), eye_r (8), eye_l (8), monocle (8)
  and torso (31). No name repeats, every coordinate is an integer in 0..1000, and `head` is present.
- **One syntax defect:** the raw text (2,015 bytes, sha256 `14932856...e5581d`) does not parse as
  JSON. The last torso point closes with `]]]}` where `]]}` belongs, at offset 2,011. The fixture
  is the recorded response with that one extra `]` removed. No coordinate, name or order was
  changed, and the result is pretty-printed. A strict JSON decoder on the server would turn this
  response into `upstream`. Resolved in task 7: `parsePartsJson` stays strict, and the parts
  step asks once more, then fails with `upstream`. The test uses this recorded reply.
- **Quality:** not judged yet. The script draws overlays from the parsed parts, and the raw text
  did not parse, so `overlay.png` and `overlay.svg` show the portrait with no polygons. The cut
  golden test in task 5 is the first visual check of these polygons.
- **Outputs (git-ignored):** `var/forge-spike-20261101-1315/parts-only/portrait/` holds `run.json`,
  `parts.raw.txt`, `check.json`, `overlay.svg` and `overlay.png`. The fixture holds polygons only,
  with no image data.

## Provenance
Gemini 3 Pro Image generated the 6 portraits (3 in run 1, 3 in run 2) and the 3 fill-edit plates
on 2026-11-01, from the preset prompts. Gemini 3.8 Flash generated the part polygons. All are
original fiction and depict no real person. The run-1 portraits are promoted to
`assets/replay/forge/` with `fictional: true` and have rows in `docs/provenance.md`. Run-2 outputs
stay in `var/`, except the downscaled composite grid `0003-forge-spike-composites.jpg` (226 KB).
