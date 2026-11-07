# Provenance and pre-existing work (Kiroween 2026 rule: "disclose any pre-existing code or work")

This repository was created on **2026-10-31** (first `git init` 17:03 UTC), inside the Kiroween
2026 submission period (2026-10-30 09:00 PT - 2026-12-04 14:00 PT). Every line of source code in
it was written during the submission period.

## Pre-existing material incorporated (art and writing only, no code)
Shadowrunner is the successor to the author's earlier, unreleased project "Overlord / Shadowrunr OS".
From it we reuse **assets and ideas only**:

| Item | Path here | Origin | Created |
|---|---|---|---|
| Arch-Lich Malakor character bible (original fiction) | `assets/characters/malakor/bible.md` | Overlord `characters/malakor/bible.md` | before 2026-10-30 |
| Malakor portrait and 18-layer rig cut from it (PNG + layers.json + depth + spec) | `assets/characters/malakor/rig/` | Overlord local `data/avatar/rig/`, staged in `assets/_incoming/malakor-rig/` and copied unchanged (23 files, byte-identical) by Kiro rig-core task 3.1 on 2026-11-01. The 18 layer PNGs and `layers.json` match the SHA-256 values Overlord recorded in `depth.json` `inputs`. | before 2026-10-30 |
| Malakor portrait and 18-layer rig cut from it (PNG + layers.json + depth + spec) | `assets/characters/malakor/rig/` | Overlord local `data/avatar/rig/` | before 2026-10-30 |
| Malakor portrait, stylised, as a 512 px WebP for the CH 4 listings (converted by Claude Code, landing task 9, 2026-11-01, from the reference copy `assets/_incoming/landing-winner/img/portrait.jpg`) | `assets/plates/portrait.webp` | the same portrait | before 2026-10-30 |
| The "Cellar Exchange" art direction (a design concept chosen in an earlier design contest) | informs `packages/theme`, `apps/web/src/landing` | Overlord design contest, 2026-10 | before 2026-10-30 |
| Rig format shape (layers with bbox/anchor/z) | re-specified in `.kiro/specs/rig-core` | idea from Overlord | - |

## Generated during the submission period
| Item | Tool | Date |
|---|---|---|
| Photoreal cellar plates promoted to `assets/plates/*.webp` (`cellar-wide`, `crt-frontal`, `root-pile`, `root-eye`, `paper`; WebP conversions by Kiro landing task 1 on 2026-11-01). `paper` comes from the round-1 contest plates (see `PROMPTS.md`). | Gemini 3 Pro Image | 2026-10-31 |
| Landing stills: `crt-frontal`, `root-cellar-wide`, `root-pile`, `root-eye` (`assets/_incoming/landing-winner/stills-source/`; prompts in `assets/_incoming/landing-winner/PROMPTS.md`) | Gemini 3 Pro Image | 2026-10-31 |
| Landing prototype The Harvest Floor (`assets/_incoming/landing-winner/`, reference only) | Claude Opus 5.5 via the contest skill, 4 rounds | 2026-10-31 |
| Forge probe overlays (`docs/decisions/0002-*.png`) | Gemini 3.8 Flash / 3.1 Pro | 2026-10-31 |
| Forge spike run 2 composite grid `docs/decisions/0003-forge-spike-composites.jpg`: 3 fresh portraits from presets 1, 3 and 5, cut by the server pipeline after a fill edit (downscaled). | Gemini 3 Pro Image (portraits, fill edits), Gemini 3.8 Flash (parts), `@sr/forge` (layers) | 2026-11-01 |
| Forge preset sources `assets/characters/presets/<slug>/{portrait.jpg, parts.json, fill.jpg}` for presets 1-5 of `assets/characters/presets/PROMPTS.md` (`lantern-warden`, `sister-vesper`, `understudy`, `moth-widow`, `announcer-of-dead-air`): portrait through `portraitPrompt`, part polygons from `PARTS_PROMPT` (parsed reply), and the fill edit from `fillPrompt`, all made by the server pipeline (`api/_lib/forge-steps.ts`) driven by `scripts/forge-spike.mjs`. Presets 1, 3, 5: spike run 2, 2026-11-01 15:58 UTC (9 paid calls); presets 2, 4: forge-pipeline task 9 run, 2026-11-01 16:25 UTC (6 paid calls). Original fiction, checked by eye: no real person, no marks, no gore. | Gemini 3 Pro Image (portraits, fill edits), Gemini 3.8 Flash (parts) | 2026-11-01 |
| Replay forge jobs `assets/replay/forge/<slug>/` (`job.json`, `portrait.*`, layer PNGs) for those 5 presets and for Malakor (`malakor/portrait.png` is a byte copy of the pre-existing `assets/characters/malakor/rig/portrait.png`, with the recorded parts `packages/forge/test/fixtures/m8-parts.json`). Built offline by `scripts/forge-replay.mjs` with the task 9 pipeline (`plateFor` -> `composePlate`, `cutAll`, `assembleRig`): the presets use their recorded fill edit (`fill: "edit"`), Malakor the pure `blurExtend` fill (`fill: "fallback"`). No paid call was made to build them. `fictional: true` in each `job.json`. Served as static files at `/replay/forge/<slug>/`. | Claude Code (Opus 5.5) via `@sr/forge`; inputs as above | 2026-11-01 |
| Cast stills `assets/replay/thumbs/<slug>.webp` (320 px WebP, quality 82): each replay forge job's `portrait.*` downscaled with PIL (Lanczos) for the creator gallery and the CH 4 listings (creator task 9, landing task 12). No new art. `saint-cardia.webp` added the same way by cast-forge task 2 (2026-11-03); `the-redactor.webp` by cast-forge task 3 with ffmpeg (area scale, libwebp q80); `vicar-of-the-lure.webp` by cast-forge task 4 with PIL (Lanczos, q82); `reveille.webp` by cast-forge task 5 with PIL (Lanczos, q80). `the-tallyman.webp` by cast-forge task 6 with PIL (Lanczos, q82). `sir-vacant.webp` by cast-forge task 7 with PIL (Lanczos, q82). `lot-ninety.webp` by cast-forge task 8 with PIL (Lanczos, q82). `auntie-asp.webp` by cast-forge task 9 with PIL (Lanczos, q80). | Claude Code (Opus 5.5), PIL | 2026-11-01 |
| Forge task 10 grid `docs/decisions/0003-forge-task10-composites.jpg` (downscaled composites of the replay jobs before and after task 10, with the head turned). | `@sr/forge` `compositeRig`, PIL downscale | 2026-11-01 |
| Forge task 9 before/after grid `docs/decisions/0003-forge-task9-composites.jpg` (downscaled composites of the replay jobs, and of spike run 2 for "before"). | `@sr/forge` `compositeRig`, PIL downscale | 2026-11-01 |
| Recorded show `assets/replay/shows/malakor-night.json`: 40 fictional audience messages and 24 Malakor lines, original writing in the voice of the bible | Claude Opus 5.5 (Claude Code, voice-and-air task 1.2) | 2026-11-01 |
| Show voice `assets/replay/shows/malakor-night/b00-b23.wav` (24 files, 16-bit mono 24 kHz, 14.4 MB, ~315 s): one run of `scripts/render-show.mjs`, voice `clerk` = Gemini prebuilt `Iapetus`. That run sent a spoken-style prefix that the model read aloud; instead of a second paid run, the prefix was cut locally (boundary from Whisper base.en word timestamps, refined to the quietest gap), the double WAV header unwrapped, the tail trimmed and pauses over 0.6 s shortened. The prefix was removed from `api/_lib/tts.ts` and the script afterwards. | Gemini `gemini-3.8-flash-tts` (owner key); local post-processing with numpy | 2026-11-01 |
| Plates `assets/plates/root-vault.webp` and `catacomb.webp` (1376x768, WebP q82), two of nine generated for the costume rounds. Prompts: "Photoreal wide shot of a brick-vaulted crypt where thick black tree roots have broken through the ceiling and hang down the walls like curtains, damp stone floor, faint cold moonlight from a grate above." and "Photoreal long catacomb corridor receding into darkness, rough-cut stone walls with empty burial niches, a few candles on the floor, low arched ceiling, symmetrical one-point perspective, cold blue light at the far end.", each followed by "Empty dark space in the centre of the frame for compositing. No people, no faces, no skeletons posed as figures, no blood, no text, no logos. Film grain, cinematic low light, deep black falloff." | Leonardo studio, GPT Image 2.5 Sunburst (quality Low), owner's account | 2026-11-01 |
| Costume prototypes `assets/_incoming/costume/` (reference only): two triage rounds of three HTML variants per page, the owner's winners kept (`r1/creator-b`, `r1/characters-c`, `r1/sealed-c`, `r2/landing-c`, `r2/creator-a`, `r2/daemon-c`, `r2/air-b`) with the briefs and the asset subset they load | Claude Opus 5.5 (Claude Code subagents), owner triage | 2026-11-01 |
| Cast portrait `assets/characters/cast/saint-cardia/portrait.png` (Saint Cardia of the Glass Heart; 1254 px render resized to 1024), contest supporting-cast entry A/6 style-3 (faceted gothic painting), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/saint-cardia/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the crown and its spires, the glass heart and its silver reliquary cage on the chest, the eyes, the lower lip and chin and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`); only its lifted regions reach the replay rig's plate | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-02 |
| Cast portrait `assets/characters/cast/the-redactor/portrait.png` (The Redactor; 1254 px render resized to 1024), contest supporting-cast entry B/6 style-3 (16-bit pixel art), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/the-redactor/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the floating black censor bar and its yellow edge line, the round black spectacles and their yellow pupils, the brass inkstamp and its chain, the lower lip and chin and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`); only its lifted regions (not the pupils') reach the replay rig's plate | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/reveille/portrait.png` (Reveille, the Alarm of the Ninth; 1254 px render resized to 1024), contest supporting-cast entry A/10 style-3 (smoked brass and neon), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/reveille/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the two brass bells on top and their stems, small T-shaped striker handle between the bells, two black clock-hand eyebrows, two glowing cyan ring eyes, cracked cyan neon line on the dial, lower jaw, its cyan neon teeth and the lower dial below them, brass winding key on the chest and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 14.6/255). It redrew the case as a whole round clock with a brighter dial, so only the bells' and hammer's lifted regions (ground) take it; every other part is filled by extension. A second edit (the jaw phrased as "the dark empty hollow inside the clock case") drifted the same way and was not kept | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/vicar-of-the-lure/portrait.png` (Vicar of the Lure; 1254 px render resized to 1024), contest supporting-cast entry A/2 style-2 (leaded stained glass), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/vicar-of-the-lure/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the glowing magenta lure bulb, thin bony lure stalk, two round milky eyes, lower jaw, its lower teeth and the chin below them and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 11.6/255); only its lifted regions reach the replay rig's plate (the throat it painted is what the open jaw uncovers) | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/the-tallyman/portrait.png` (The Tallyman; 1254 px render resized to 1024), contest supporting-cast entry A/3 style-3 (low-poly 3D), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/the-tallyman/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the six round eyes with their glowing chartreuse irises, the small brass pince-nez on the nose, the thin lower lip, the bone abacus beads on the collar rods and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 5.4/255). It drew closed lids where the eyes were (used for the blinks) and redrew the abacus with four bare rods for three, so the bead groups are filled by extension | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/sir-vacant/portrait.png` (Sir Vacant; 1254 px render resized to 1024), contest supporting-cast entry B/10 style-2 (naive heraldic miniature), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/sir-vacant/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the tall black horsehair plume on top of the helm, two spiked shoulder pauldrons, rusted iron chain across the chest, three wax-sealed paper tags hanging from it and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 12.0/255, the whole-image re-render). It kept the crest band and painted the surcoat's shoulders under the pauldrons; the eye slits and the bevor are filled by extension, not from it | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/lot-ninety/portrait.png` (Lot Ninety, the Auctioneer; 1254 px render resized to 1024), contest supporting-cast entry A/4 style-1 (art nouveau poster), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/lot-ninety/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the slicked-back black hair, two glowing green eyes, grinning lower teeth and lower lip, small black bow tie, high white wing collar, two floating white gloves and their green ghost flames and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 23.6/255, the whole-image re-render). It painted a bald scalp, closed lids and a plain shirt collar; the gloves, flames and wing collar are filled by extension, not from it | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Cast portrait `assets/characters/cast/auntie-asp/portrait.png` (Auntie Asp, Keeper of the Stone Stacks; 1254 px render resized to 1024), contest supporting-cast entry A/9 style-2 (art nouveau poster), prompt in `brief.json` `style.prompt` | Codex CLI built-in image generation (codex-cli 0.160.0) | 2026-11-02 |
| Fill edit `assets/characters/cast/auntie-asp/fill.jpg`: an edit of the portrait above with the prompt "Same image, same framing and lighting. Remove the six grey serpents rising from her head, two glowing orange eyes, round wire spectacles, lower lip, high ruffled blouse collar and paint the plausible surface that would be behind them. Change nothing else." (1254 px, area-resized to 1024, JPEG q92 by `scripts/cast/import-fill.mjs`, mean difference 11.6/255, the whole-image re-render). It painted a bald cracked dome, open grey eyes and the neck down to a round neckline, and kept the lips; the eyes and the collar's back band are filled by extension, not from it | Codex CLI built-in image generation (edit with the portrait as input image) | 2026-11-03 |
| Replay forge jobs `assets/replay/forge/<slug>/` (`job.json`, `portrait.png`, layer PNGs) for the eight cast-forge characters (`saint-cardia`, `the-redactor`, `vicar-of-the-lure`, `reveille`, `the-tallyman`, `sir-vacant`, `lot-ninety`, `auntie-asp`): built offline by `scripts/cast-forge.mjs` from each character's portrait, `parts.json` (named parts measured from the portrait's pixels) and fill edit above (`fill: "edit"`), no paid call; `fictional: true`. No new art beyond the portraits and fills: every layer is cut from them. Cast-forge task 12 rebuilt `reveille/job.json` after its teeth part gained `follow: "jaw"` (the brief contract's teeth-or-lip set); every layer PNG is byte-identical and every pose equal. | Claude Code (Opus 5.5), the repo's forge pipeline | 2026-11-03 |

Designed and generated art is stylised and labelled as such in the UI; no real person is depicted.
- **Expression faces (character-control, 2026-11-03).** 84 image edits, six expression families
  (joy, showman, anger, gloom, smug, suspicion) for each of the fourteen recorded characters, made
  with the Codex CLI's built-in image generation from each character's committed portrait
  (`scripts/cast/expressions.mjs --request`; prompts are `expressionPrompt` in
  `packages/forge/src/expressions.ts`). Only pixels inside each face mask were cut into patches
  (`cutVariants`), stored as WebP beside the layers (`<layer>.<family>.webp`; Malakor's in
  `assets/characters/malakor/rig/expressions/`). All 84 kept by the owner's verdict, including the
  19 whose drift exceeded the 20/255 flag. Colour region maps (`<layer>.regions.png`) are computed
  from the committed layers with no model call. These faces were made with the pre-round-3 prompt,
  which painted the mouth; llm-avatar-lab (2026-11-06) reset their mouth area to the neutral lips
  (`resetMouth`, `scripts/cast/mouth-backfill.mjs`, no model call), and forges since then use the
  upper-face prompt that leaves the mouth to the rig's drawn mouth.
- **Face control (spark face-control, 2026-11-06).** New Codex CLI image edits (codex-cli 0.166.0,
  built-in image generation, each an edit of the character's committed portrait as input image) for
  the four painterly characters Saint Cardia, Auntie Asp, the Moth Widow and Sister Vesper, kept in
  `var/cast-eyes/<slug>/` and `var/cast-expr/<slug>/` (never committed); only what is cut from them
  reaches `assets/replay/forge/<slug>/`:
  - 4 iris-free edits (`irisFreePrompt`: paint the whites where the irises are, keep lids and
    lashes): Cardia's and Vesper's whites become the iris-free eye layers; the Moth Widow's and
    Asp's eyes have no white, so theirs only measure the lid opening (their sockets are filled
    procedurally) and the human whites they painted are not used.
  - 3 mask edits (Cardia, Vesper, the Moth Widow: the eye openings painted flat green, the irises
    magenta) that measure the socket and the iris; no pixel of them is shipped.
  - 4 closed-eyes edits (`closedEyesPrompt`, without a style sentence): the closed-lid art
    (`<eye>.closed.png`) a blink crossfades to.
  - 37 expression edits with face-control's strict prompt (`expressionPrompt`: change only the brows
    and lids, keep the irises' place and the face's structure; re-runs add the `STRICTER` sentences):
    24 first attempts, 10 second, 3 third. Each was laid back on the portrait (`registerEdit`) and
    measured (`faceStability`); 22 passed and were cut to the brow+lid band (head, hair and eye
    faces, WebP q88 with lossless alpha), 2 families stayed without a face after three refusals
    (Cardia showman, Vesper joy). The 2026-11-03 faces of these four were retired.
  - 3 more expression edits for Auntie Asp after the owner's board (anger, gloom, suspicion, the strict
    prompt plus `INK_BROWS`: keep the brows bold ink and move them): only their head faces (her brows)
    are cut, her eye faces stay the earlier edits'.
  No paid call; the live forge uses the same prompts on its image model.
- **Cast face pass (spark cast-face-pass, 2026-11-06).** The other nine Kiroween characters get the
  same eyes and faces. New Codex CLI image edits (codex-cli 0.166.0, built-in image generation, each
  an edit with an input image), kept in `var/cast-eyes/<slug>/` and `var/cast-expr/<slug>/` (never
  committed); only what is cut from them reaches `assets/replay/forge/<slug>/`.
  The human-eyed four (WP1: Lot Ninety, the Understudy, the Tallyman, the Redactor), requests by
  `scripts/cast/eyes.mjs --request` and `scripts/cast/expressions.mjs --request` (recipes in
  `scripts/cast/faces/`):
  - 2 iris-free edits (Lot Ninety, the Understudy): the Understudy's whites become its iris-free
    eyes; Lot Ninety's edit gives his socket and the shading of his whites, recoloured to his own
    dim grey-green (the edit painted them cream).
  - 2 mask edits (the same two: openings green, irises magenta) that measure the iris; no pixel of
    them is shipped.
  - 1 closed-eyes edit (the Understudy's porcelain lids, `<eye>.closed.png`); Lot Ninety's and the
    Tallyman's closed lids are their own plates; the Redactor's is procedural (the unlit lens with a
    dim one-cell dash).
  - 2 no-op re-render edits (the Tallyman, the Redactor: `scripts/cast/faces/floor.mjs`) that
    measure the editor's noise floor; no pixel of them is shipped.
  - 34 expression edits with the strict prompt plus a material sentence where the character needs
    one (porcelain puppet eyes; six ring irises and the pince-nez; pixel art on a 7-pixel grid):
    Lot Ninety 9 (6 first, 2 second, 1 third attempts), the Understudy 15 (6, 6, 3), the Tallyman 4,
    the Redactor 6. 19 passed the gate (iris drift <= 4 px; outside-band change <= the editor's floor
    + 1.5) and were cut to the brow+lid band: Lot Ninety 6, the Understudy 3 (showman, smug,
    suspicion; joy, anger and gloom stayed without a face after three refusals), the Tallyman 4
    (joy, showman, anger, suspicion), the Redactor 6.
  - The Tallyman's gloom and smug faces are his 2026-11-03 faces re-cut to the band (no new edit):
    measured as composites against his old rig at rest (limit: the committed WebP's floor + 1.5).
    All other 2026-11-03 faces of the four were retired.
  Procedural (no model): the iris layers are cut from each eye as painted (the Redactor's 2-cell
  pupil whole, its eye layer grown to the lens interior); the sockets of the Tallyman and the
  Redactor are measured from the art; Lot Ninety's maw (`RigLips.maw`) is measured by `measureMaw`.
  The non-human five (WP1b: the Announcer of Dead Air, the Lantern Warden, Reveille, Sir Vacant
  and the Vicar of the Lure), requests written by `scripts/cast/five/request.mjs`, prompts in
  `scripts/cast/five/prompts.mjs`:
  - 54 expression edits of the portraits with a material-specific strict prompt (`facePrompt`: only
    the area around the eyes changes, in the character's own material - void-skull socket rims,
    carved pumpkin holes and brow notches, neon rings and clock-hand brows, steel visor slits,
    lead-framed glass panes; never eyeballs, irises, pupils, lids or skin; the mouth untouched;
    re-runs add one or two stricter sentences): Announcer 9, Lantern Warden 18, Reveille 6, Sir
    Vacant 6, Vicar 15. Each was laid back on the portrait (`registerEdit`) and gated (outside-band
    change <= the character's own no-op re-render + 1.5; iris drift <= 4 px by each character's own
    track); 24 passed and were cut to the brow+lid band (head, eye and brow faces, WebP q88 with
    lossless alpha; no mouth layer gets a face). Families without a passing edit keep no face:
    Reveille showman, Vicar joy, showman, smug, suspicion. Reveille's gloom face is its 2026-11-03
    face re-cut to the band (no new edit). All 2026-11-03 faces of the five were retired.
  - 5 no-op re-render edits ("return this exact image unchanged"), one per character, that measure
    the editor's own noise floor; no pixel of them is shipped.
  - 3 closed-eye edits: the Lantern Warden's unlit carved holes, Reveille's rings reduced to their
    lower arcs, the Vicar's lead-framed blue glass lids (`<eye>.closed.png`, a blink's art). The
    Announcer's and Sir Vacant's closed art is their own plate (the unlit hole, plus a procedural
    ember, and the unlit slit).
  - 8 mask edits of the Lantern Warden's face edits (input: the face edit; its recut eye holes
    painted flat green) that give each face its socket; no pixel of them is shipped.
  Procedural (no model): the Announcer's and the Lantern's iris layers are cut from their own light
  and the light's place in the eye is filled from the art around it; Reveille's neon dots and Sir
  Vacant's white lights are drawn glow orbs (`orbArt`). No paid call.
  - Lot Ninety's neutral rest mouth (owner, 2026-11-07: "default face should not smile"): 3 Codex CLI
    edits (codex-cli 0.166.0, input: his forge portrait) replacing the clenched-teeth grin with closed,
    level lips, kept in `var/cast-mouth/lot-ninety/`; the third (no corner hooks, no ghost teeth) was
    resized 1254 -> 1024 and composited into `portrait.png` only inside the old grin's crescent (grown
    5 px, feathered; the edit's redrawn crease and chin-crease bits inside it replaced by its own
    nearby skin), so every pixel outside that box (425,386 179x102) is the original. `head.png` and
    `jaw.png` re-cut from it; the mouth now bends by the lip warp (`Rig.mouth.lips`).
    His gallery thumbnail `assets/replay/thumbs/lot-ninety.webp` was re-made from the edited portrait
    (PIL Lanczos, q82); the cast source `assets/characters/cast/lot-ninety/portrait.png` keeps the grin.
  - Owner verdict 2026-11-07: Reveille, the Tallyman and the Vicar of the Lure were reverted to their
    2026-11-06 art and rigs, so none of the edits counted above for them ship. Sir Vacant keeps
    his regenerated faces and the bevor without patches, but his eyes are the 2026-11-06 slits (no
    socket, light orb or closed edit) and his showman face was dropped (it opened the visor for the orb).
- **Avatar packs (avatar-pack, 2026-11-04).** Malakor (pre-existing art, above) is never packed:
  `scripts/build-packs.mjs` skips him when it publishes the cast as `/packs/<slug>.srpack`, and the
  creator offers no Export for him, so he is never exported or published as a pack.
- **Avatar Lab voice (spark llm-avatar-lab, 2026-11-05).** `tools/lab-voice` speaks with Kokoro-82M
  v1.0 (hexgrad, Apache-2.0 weights, stock voices only, no cloning) through `kokoro-onnx` 0.6.1
  (MIT), model files `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx
  `model-files-v1.1` release, downloaded by `pnpm lab setup` into `var/lab/models/` (never
  committed). The lab's ideas (a TTS sidecar that returns per-phoneme timing, phoneme-to-viseme
  spans, A/B arms compiled into one event timeline) are concepts re-derived from the author's
  earlier Overlord project; no Overlord code was copied.
