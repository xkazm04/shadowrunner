# Design: forge-pipeline

## Overview
Pure image work in `packages/forge` (depends only on `packages/rig` and a PNG codec); network and
keys only in `api/`. A forge job is **client-driven**: Vercel functions are short-lived, so the
browser polls and each `GET` advances one step. PNG codec: **`upng-js`** (pure JS, small, no
native build; encodes/decodes RGBA).

```
packages/forge/src/types.ts      Part, PartName, Polygon, Rgba (server-side)
packages/forge/src/wire.ts       ForgeRequest, ForgeStatus, JobView, ForgeErrorCode - types only, exported as `@sr/forge/wire`, the ONLY declaration; the creator imports it
packages/forge/src/prompts.ts    HOUSE_STYLE, portraitPrompt(text), restylePrompt(), PARTS_PROMPT, fillPrompt(parts), LIKENESS_PROMPT
packages/forge/src/parts.ts      parseParts (schema validation), PART_KIND table, toCanvas (0..1000 -> px)
packages/forge/src/mask.ts       rasterizeMask (scanline fill + distance feather), lumaKey
packages/forge/src/cut.ts        cutLayer, cutAll (front-to-back order), bboxOfMask
packages/forge/src/fill.ts       blurExtend (pure fallback)
packages/forge/src/palette.ts    samplePalette
packages/forge/src/assemble.ts   assembleRig (uses @sr/rig validateRig)
packages/forge/src/png.ts        decodePng/encodePng/dataUrl via upng-js
api/_lib/gemini.ts               generateImage, editImage, generateJson (fetch, 55 s timeout, model ids from env)
api/_lib/quota.ts                SHARED with voice-and-air: checkAndCharge(ip, kind, usdEstimate)
api/_lib/jobstore.ts             JobStore interface + MemoryJobStore + RedisBlobJobStore
api/_lib/errors.ts               ForgeError -> { error: { code, message } }
api/forge/index.ts               POST
api/forge/[jobId].ts             GET (advance one step)
api/_lib/forge-steps.ts          runStep(job): portrait | parts | cut | fill | assemble
scripts/forge-spike.mjs          spike (owner key, not in tests)
assets/replay/forge/<slug>/      job.json (recorded statuses + final rig) + layer PNGs
```

## Contracts (wire names)
```ts
export type PartName = "head" | "jaw" | "eye_l" | "eye_r" | "monocle" | "crown" | "torso" | "hat" | "hair" | "accessory";
export interface Part { name: PartName; box_2d: [number, number, number, number]; poly: [number, number][] } // [y,x] 0..1000
export type ForgeStatus = "queued" | "portrait" | "segmenting" | "cutting" | "filling" | "done" | "failed";
export type ForgeErrorCode = "quota" | "refused_likeness" | "refused_content" | "upstream" | "bad_input";
// POST /api/forge  body: { mode: "prompt" | "image", prompt?: string, imageBase64?: string }  -> 202 { jobId }
// GET  /api/forge/:jobId -> JobView
export interface JobView {
  jobId: string; status: ForgeStatus; plane: "replay" | "live";
  portraitUrl?: string;                 // available from status "segmenting" on
  rig?: Rig;                            // only when status "done"; layer.file = key in assets
  assets?: Record<string, string>;      // file -> URL (https Blob URL on live, data: URL on replay/dev)
  fill?: "edit" | "fallback";
  error?: { code: ForgeErrorCode; message: string };
}
```
`brief.md` previously named the "done" step generically; the status list adds `filling` between
`cutting` and `done` (resolved here; the creator spec renders every status).

PART_KIND: head->head, jaw->jaw, eye_l/eye_r->eye, monocle/hat/accessory->accessory,
crown/hair->crown, torso->body. A `static` background layer is the filled torso plate's ground
(solid near-black), so every rig has `background` at z 1.

## Prompts (exact)
HOUSE_STYLE: "Original character portrait, head and shoulders bust, facing the camera, centred,
symmetrical framing, theatrical horror, painterly realism, dramatic rim light, the face clearly
separated from the body, the jaw and eyes clearly visible, near-black (#050505) empty background,
no text, no logos, no frame, not a real person, no gore, 1:1."
portraitPrompt(t) = `${HOUSE_STYLE} The character: ${t.slice(0, 400)}`.
restylePrompt = `Redraw this image as: ${HOUSE_STYLE} Keep the character's defining features, costume and colours.`
LIKENESS_PROMPT (to `gemini-3.8-flash`, JSON): "Classify this image. Return {\"real_person\": boolean,
\"unsafe\": boolean, \"reason\": string}. real_person is true if it shows a photograph or realistic
depiction of an identifiable real human face. unsafe is true for sexual content, gore or hate symbols."
PARTS_PROMPT (to `gemini-3.8-flash`, the probed prompt, extended list): "This is a character
portrait to be cut into animation layers. For each visible part among: head (skull/face, excluding
crown, hair, hat and jaw), jaw (lower jaw that moves when speaking), eye_l (character's left eye),
eye_r, monocle, crown (all crown spikes together), hat, hair, accessory (one other worn object on
the head), torso (shoulders/robe), return a tight polygon outline. Return JSON: [{\"name\": string,
\"box_2d\": [ymin,xmin,ymax,xmax], \"poly\": [[y,x],...]}] with coordinates normalized to 0-1000,
8-40 points per polygon, clockwise. Omit parts that are not visible."
fillPrompt(parts) = `Same image, same framing and lighting. Remove the ${parts.join(", ")} and paint the plausible surface that would be behind them. Change nothing else.`

## Cut algorithm
1. Decode portrait; scale polygons 0..1000 -> 1024 px. 2. Order: eye_l, eye_r, monocle, accessory,
hat, crown, hair, jaw, head, torso. 3. Per part: `rasterizeMask(poly, 1024, 1024, feather=3)`,
multiply by `lumaKey(lo=10, hi=28)` for crown/hair/accessory (gaps key out); subtract masks of
parts already cut (cores never overlap). 4. `cutLayer` crops to bbox. Head and torso plates are
cut from the **filled** portrait (step order on the server: parts -> fill -> cut).

## Job store (decision)
Live: **Upstash Redis via Vercel Marketplace (KV)** for job JSON (`job:<id>`, TTL 24 h, <= 50 KB:
statuses, parts, URLs) and **Vercel Blob** for images (`forge/<jobId>/<file>.png`, random
suffix, deleted by a daily cron `api/cron/forge-gc.ts`). Replay and `pnpm dev` without
credentials: `MemoryJobStore` + data: URLs. Selected by `SR_PLANE` and presence of
`KV_REST_API_URL`; images never sit in KV.

## Quota (shared module)
`checkAndCharge(ip: string, kind: "forge" | "engine" | "voice", usd: number): { ok: true } | { ok: false; code: "quota" }`.
Counters in KV (`quota:<yyyy-mm-dd>:<kind>:<ipHash>`, `quota:<date>:usd`), in memory on replay.
IPs are stored as SHA-256 with a server salt. Limits from env: `SR_FORGE_PER_IP` (3),
`SR_ENGINE_PER_IP` (60), `SR_VOICE_PER_IP` (60), `SR_DAILY_USD_CAP` (5). Cost estimates per call are
constants in `api/_lib/costs.ts` (illustrative, not billing).

## Testing strategy
- fast-check: rasterized opaque core always inside polygon (point-in-polygon), feather band width
  <= feather; lumaKey monotonic in luma; cut cores disjoint across parts; `parseParts` rejects
  arbitrary out-of-range / malformed inputs; `assembleRig` output always passes `validateRig` for
  arbitrary valid part sets including `head`.
- Golden: Malakor portrait + the recorded probe polygons (`packages/forge/test/fixtures/m8-parts.json`)
  produce a valid rig with 7+ layers.
- API: steps with a fake Gemini client (injected), quota exhaustion returns `quota` before any
  fake call; replay plane makes zero fetches (fetch stubbed to throw).

## Amendment: character-control (2026-11-03)
After assembly a live job enters `expressing` and runs one image edit per expression family (six,
each charged like the fill edit), cutting each family's patches inside the face mask only
(`expressions.ts`); a failure, a spent budget or a drift over 20/255 skips that family and the job
still finishes `done`, with `JobView.expressions` saying which. The assemble step also writes colour
regions per layer (`regions.ts`, no model call). The global daily cap default is 30 USD.
