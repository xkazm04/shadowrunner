# Requirements: forge-pipeline

## Introduction
The forge turns a typed description or an uploaded image into a living character: a house-style
portrait, cut into a layered **Rig v1** (from `packages/rig`) the creator and stage render
unchanged. The pipeline is five steps (portrait -> parts -> cut -> fill -> assemble). The pure
steps live in `packages/forge` and are tested without network; `api/forge` is a thin, quota-guarded
door that holds the keys. Part detection is proven: on 2026-10-31 `gemini-3.8-flash` returned all
7 Malakor parts as polygons in 20.4 s, while mask output degenerated
(`docs/decisions/0002-forge-probe-*.png`). Replay serves pre-forged jobs so a judge can forge with
no keys.

## Requirement 1: Spike before build
**User story:** As the owner, I want the pipeline proven on fresh portraits before the UI depends on it, so that the creator's core promise is not a week-4 surprise.

#### Acceptance criteria
1. `scripts/forge-spike.mjs` SHALL run the full pipeline on 3 generated portraits using the owner's key from the environment, write outputs under `var/forge-spike/`, and never run in `pnpm test`.
2. The spike SHALL record per portrait: step timings, part count, `validateRig` result, and a composite screenshot path in `docs/decisions/0003-forge-spike.md`.
3. IF fewer than 2 of 3 portraits produce a valid rig THEN the decision record SHALL adopt the **pose-template fallback** (portraits generated against a fixed bust template whose part regions are known; segmentation only refines) before task 3 starts.

## Requirement 2: Portrait
**User story:** As a streamer, I want my description or image turned into a portrait in the house style, so that every character belongs in the cellar.

#### Acceptance criteria
1. WHEN `mode: "prompt"` THEN the server SHALL generate a portrait from the house-style template in design.md with the user's text inserted, using the draft model first and the final model on reveal.
2. WHEN `mode: "image"` THEN the server SHALL first classify the upload; IF it shows a real, identifiable person THEN the job SHALL fail with `refused_likeness`; IF it shows sexual, gore or hateful content THEN with `refused_content`.
3. WHEN an upload passes THEN the server SHALL restyle it into the house style (image edit) rather than cut the upload itself.
4. Uploads SHALL be at most 8 MB, PNG/JPEG/WebP, otherwise `bad_input`; uploads SHALL NOT be persisted beyond the job's lifetime (24 h).
5. Every generated portrait SHALL be 1024x1024 on a near-black ground.

## Requirement 3: Parts
**User story:** As the pipeline, I want named part polygons, so that each part can move on its own.

#### Acceptance criteria
1. The server SHALL request parts from the segmentation model with the exact prompt in design.md and `responseMimeType: application/json`.
2. `parseParts(json)` SHALL validate `[{ name, box_2d, poly }]` (coords integers 0..1000, `poly` 3..60 points, names from the closed list) and reject anything else with `upstream`.
3. A result without `head` SHALL fail the job with `upstream`; missing optional parts are allowed.
4. Part names SHALL map to `LayerKind` per the table in design.md.

## Requirement 4: Cut
**User story:** As the renderer, I want clean transparent layers, so that parts move without halos.

#### Acceptance criteria
1. `rasterizeMask(poly, w, h, feather)` SHALL produce an alpha mask in [0,255] whose fully-opaque area lies inside the polygon and whose feather band is at most `feather` px wide.
2. `lumaKey(rgba, lo, hi)` SHALL make near-black ground transparent (luma <= lo -> 0, >= hi -> 255, linear between).
3. `cutLayer(portrait, mask)` SHALL return an RGBA image cropped to the mask's bbox plus the bbox in canvas px.
4. Cutting SHALL be front to back (eyes, monocle/accessories, jaw before head; head before torso) so no pixel belongs to two layers' opaque cores. Exception (director ruling 2026-11-01): when a filled plate is given, head and torso are cut from the plate and may lie under the cores of `FILL_PARTS` (eyes, monocle, accessory, jaw), so an open jaw or a moving eye reveals painted surface, never a hole.
5. All cut functions SHALL be pure over `{ width, height, data: Uint8ClampedArray }` and tested without network.

## Requirement 5: Fill
**User story:** As a viewer, I want no black holes when the jaw opens, so that the face stays believable.

#### Acceptance criteria
1. The head and torso plates SHALL have the regions of lifted parts filled before they become layers.
2. The server SHALL fill with a Gemini image edit ("same image, remove <parts>, paint plausible surface") using the final image model.
3. IF the edit fails or times out (30 s) THEN the pure fallback `blurExtend(plate, mask)` SHALL fill the hole, and the job SHALL record `fill: "fallback"`.

## Requirement 6: Assemble
**User story:** As the creator, I want a rig that validates, so that a forge result never crashes the renderer.

#### Acceptance criteria
1. `assembleRig(parts, layers, meta)` SHALL output a `Rig` with `version: 1`, `source: "forge"`, `fictional: true`, depth defaults by kind, and `follow: "head"` for jaw, eyes, accessories and crown.
2. Anchors SHALL be: jaw = top-centre of its bbox (the hinge); eyes and accessories = polygon centroid; head = bottom-centre; torso and static = bbox centre.
3. The palette SHALL be sampled from the portrait (eye glow = brightest saturated hue inside eye polygons; glow/rim derived) as `#rrggbb`.
4. `validateRig` SHALL pass on every assembled rig; a failure fails the job with `upstream` and logs the error codes.

## Requirement 7: Jobs, quota and planes
**User story:** As the owner, I want live forging capped and judges never stuck, so that the hosted demo is safe to leave on.

#### Acceptance criteria
1. `POST /api/forge` SHALL create a job and run the portrait step; `GET /api/forge/:jobId` SHALL advance at most one step per call and return the job view in design.md.
2. Each step SHALL finish within a single function invocation (<= 60 s); job state SHALL live in the JobStore (design.md), never in function memory, on the live plane.
3. `api/_lib/quota.ts` SHALL enforce a per-IP daily forge count (default 3) and a global daily USD estimate against `SR_DAILY_USD_CAP` (default 5); exceeding either fails with `quota` before any paid call. This module is shared with `voice-and-air`.
4. Errors SHALL be `{ error: { code, message } }` with codes `quota`, `refused_likeness`, `refused_content`, `upstream`, `bad_input`.
5. WHEN the plane is `replay` THEN `POST` SHALL return a pre-forged job from `assets/replay/forge/*` chosen by hashing the prompt, and `GET` SHALL step through its recorded statuses with 1.5-3 s latency, with no network calls.
6. Secrets and raw upstream errors SHALL never reach the client.
