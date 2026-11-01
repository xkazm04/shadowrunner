# 0003: Forge spike on fresh portraits

- **Status:** provisional (2026-11-01). The rig column waits for forge-pipeline tasks 3-6. Re-run
  `scripts/forge-spike.mjs` with cut and assemble in place, then make this decision final.
- **Spec:** forge-pipeline requirement 1, task 1.
- **Run:** 2026-11-01 13:15 UTC, one pass, no retries needed. Portraits from `gemini-3-pro-image`
  (`portraitPrompt`), parts from `gemini-3.8-flash` (`PARTS_PROMPT`, `responseMimeType:
  application/json`). Client timeout 120 s, so the timings below are true latency.
- **Prompts:** presets 1, 3 and 5 from `assets/characters/presets/PROMPTS.md` (351-377 characters,
  so none was cut by the 400-character limit).
- **Outputs:** `var/forge-spike/` (git-ignored): `summary.json`, and per portrait `prompt.txt`,
  `portrait.jpg`, `parts.raw.txt`, `parts.json`, `check.json`, `overlay.svg`, `overlay.png`.

## Results

| Portrait | Portrait step | Parts step | Total | Parts (valid / returned) | Expected parts found | Rig assembled and validated | Overlay |
|---|---|---|---|---|---|---|---|
| Lantern Warden (preset 1) | 15.0 s | 17.1 s | 32.0 s | 6 / 6 | 6 of 6 (head, jaw, eye_l, eye_r, hat, torso) | pending tasks 3-6 | `var/forge-spike/lantern-warden/overlay.png` |
| The Understudy (preset 3) | 15.4 s | 13.7 s | 29.1 s | 6 / 6 | 6 of 6 (head, jaw, eye_l, eye_r, accessory, torso) | pending tasks 3-6 | `var/forge-spike/understudy/overlay.png` |
| Announcer of Dead Air (preset 5) | 15.9 s | 19.6 s | 35.6 s | 7 / 7 | 7 of 7 (head, jaw, eye_l, eye_r, hat, crown, torso) | pending tasks 3-6 | `var/forge-spike/announcer-of-dead-air/overlay.png` |

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

## Decision (provisional)
**Keep polygons. Do not adopt the pose-template fallback yet.** All 3 fresh portraits returned
`head` and every expected part as valid polygons in 13.7-19.6 s. That matches the 2026-10-31
Malakor probe (0002: 7 parts, 20.4 s). The rule in requirement 1.3 is about valid rigs: if fewer
than 2 of 3 portraits produce a valid rig, the pose-template fallback is adopted. That rule cannot
be applied until cut and assemble exist (tasks 3-6), so this decision rests on part quality alone.
Findings 1-4 are the risks most likely to break a rig, and tasks 2.1 and 3 should handle them.

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
  response into `upstream`. Task 6.1 (`generateJson`) and task 7 decide whether to tolerate it,
  retry, or fail; this record does not.
- **Quality:** not judged yet. The script draws overlays from the parsed parts, and the raw text
  did not parse, so `overlay.png` and `overlay.svg` show the portrait with no polygons. The cut
  golden test in task 5 is the first visual check of these polygons.
- **Outputs (git-ignored):** `var/forge-spike/parts-only/portrait/` holds `run.json`,
  `parts.raw.txt`, `check.json`, `overlay.svg` and `overlay.png`. The fixture holds polygons only,
  with no image data.

## Provenance
The 3 portraits were generated by Gemini 3 Pro Image on 2026-11-01 from the preset prompts. They
are original fiction and do not depict a real person. Before any portrait is promoted to
`assets/replay/forge/` (task 8), it needs a row in `docs/provenance.md` and `fictional: true`.
