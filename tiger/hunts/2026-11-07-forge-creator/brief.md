# Territory dossier - packages/forge/src, apps/web/src/creator (+ api/_lib/forge-*)

Commit: aaa2b54ff7 - written 2026-11-07

## Why this area

Shadowrunner's README opens with "Forge an AI co-host... Describe a character or upload a picture.
Shadowrunner turns it into a living 2.5D face, cut into layers, lit, breathing and blinking"
(README.md:5-7). The product steering names the target user as "streamers who want an AI co-host
character without rigging skills, GPUs or installs" (.kiro/steering/product.md:17). The forge
(words or picture -> layered, animated rig) and the creator (where the result is tuned, kept and
handed off) are that promise. Hunt evidence (`tiger.mjs hunt`, git last 180 days at aaa2b54):
packages/forge/src heat 100 (133 commits, 332 kB), apps/web/src/creator heat 93 (124 commits,
283 kB): the two hottest areas in the repo. scripts/cast (heat 58) is the offline toolchain that
feeds the forge's recorded cast. The operator chose this area over the living-face renderer and the
on-air stage.

## Who uses it, for what

- **The streamer (primary).** Job: get a distinctive, original character that moves convincingly
  and talks, in minutes, without rigging. Loop: describe -> approve brief -> watch it forge ->
  tune mood/look/voice -> put on air / export (embed, OBS overlay, studio video, .srpack).
  "Done well" = the forged face looks as good as the hand-tuned recorded cast, moves without
  ghosts or seams, and has expressions that change the painting, not just the transform.
- **The first-visit judge / visitor (Kiroween 2026 Costume Contest).** No keys: everything runs on
  the replay plane (recorded forges, RECORDED badge, product.md:21). Judges see recorded jobs only.
- **The owner as cast director.** Builds the 13-character recorded cast offline with
  scripts/cast-forge.mjs + per-character recipes, reviews sheets by eye, writes lessons to
  docs/cast-forge-ledger.md (514 lines), which feed the live decomposition prompt.

No uat Characters or bp product tree exist in this repo.

## What it does today

**Live pipeline** (server, stepwise; POST runs step 1, each GET runs at most one more step;
statuses queued -> portrait -> segmenting -> cutting -> filling -> expressing -> done,
api/_lib/forge-steps.ts:1-17; 60 s step lease api/_lib/forge-api.ts:16,99; job record in KV
<=50 KB, never image bytes, packages/forge/src/job.ts:1-3,15-55):

| Stage | Where | Model / algorithm |
|---|---|---|
| Request validate | packages/forge/src/validate.ts:48,77 (prompt <=2000 chars, upload 3 MB) | deterministic |
| Brief ("handshake") | api/_lib/forge-brief.ts:57 `liveBrief`; prompt/schema packages/forge/src/brief.ts:43,51; parsed validate.ts:93 | Claude Messages API, json_schema, thinking off, effort low (forge-brief.ts:47-55). Brief = name, style, 6-24 named parts with role/motion/follow, <=900-char portrait prompt (brief.ts:17-26) |
| Likeness check (upload) | forge-steps.ts:129,140-144, LIKENESS_PROMPT prompts.ts:21 | Gemini 3.8 flash, 20 s; refuses real persons |
| Portrait | forge-steps.ts:131-136 (restyle :185); prompts.ts:4,11, brief.ts:237 | gemini-3-pro-image, 1024^2 |
| Segmentation | forge-steps.ts:192 (v1, ten fixed names), :216 `namedParts` (brief parts via partsPromptFromBrief brief.ts:256, settled briefParts.ts:157) | gemini-3.8-flash polygons; one re-ask on non-JSON; brief parts asked twice, then fall back to v1 names with `decomposition:"fallback"` (forge-steps.ts:204-232) |
| Fill / plate | forge-steps.ts:239 `fillEdit`; fillPromptFromBrief briefParts.ts:203 | Gemini edit 30 s; deterministic blur fallback plate.ts:46, fill.ts:40 on any failure (forge-steps.ts:243-258) |
| Cut | cut.ts:240 `cutAll`, cutNamed.ts:89,135 | deterministic raster/feather (mask.ts:144,154), luma key (mask.ts:253), plate matte (matte.ts:26), mouth cavity (mouth.ts:137) |
| Rig v1 assemble | assemble.ts:134; forge-steps.ts:280,298 | deterministic pivots, palette (palette.ts:154), measured mouth/lips/maw (mouthAnchor.ts:73, mouthLips.ts:225, mouthMaw.ts:87) |
| Colour regions | regions.ts:256,358 | deterministic, byte-identical (golden-pinned) |
| Socketed eyes | api/_lib/forge-eyes.ts:53 -> faceEyes.ts:136 | 2 parallel Gemini edits (iris-free, closed), 35 s; unsure eyes stay one painted piece (faceEyes.ts:112,156-185) |
| Six expression faces | api/_lib/forge-expressions.ts:53,110 - one family per GET: joy, showman, anger, gloom, smug, suspicion (packages/rig/src/control.ts:6) | Gemini edit 40 s each; `registerEdit` (stability.ts:255) + `faceStability` gate: refuse if iris drifts >4 px or off-band change > floor+1.5 (stability.ts:19-29,168,221); refused/failed families stay "procedural" and never fail the forge (forge-expressions.ts:8-10,66-77) |

Costs per paid call: final image / fill edit / expression $0.14 each, draft image $0.04
(api/_lib/costs.ts:5-13). Each step charges a shared quota first. Failure codes: quota,
refused_likeness, refused_content, upstream, bad_input (forge-steps.ts:169-183).

**Replay plane** (default): stateless job ids encode slug + start time; status derived from elapsed
time over recorded holds (api/_lib/forge-replay.ts:105-128). There are 14 recorded jobs under
assets/replay/forge/ (8 hand-built cast + 5 presets + Malakor). A brief's request matches a cast
job, else the SHA-256 of the prompt picks one. The browser replay client mirrors this
(apps/web/src/creator/forgeClient.replay.ts:8-15,56-69); `?forge=fail:<code>` seeds failures.

**Offline cast path**: scripts/cast-forge.mjs runs the same modules (scripts/forge-lib.mjs:13-19)
with per-character recipes (scripts/cast/recipes/*). Image edits (fill, eyes, expressions) go via
`codex exec`. Review is human, on composite sheets (var/cast-forge/<slug>*.png).
scripts/cast/live-proof.mjs proves "the product path and the overnight path are one path" by running
the live steps against a fake Gemini that answers with a cast character's committed files and
diffing pixels against the replay job.

**Creator UI** (apps/web/src/creator):
- /creator/new, the Rite in four marks (rite/RitePage.tsx:87):
  - I Describe: words 10-500 chars, 3 example chips, or a drawing <=5 MB (rite/request.ts:9-17,
    rite/Marks.tsx:70-118). The brief card lets you edit name, style, each part's role and motion,
    or drop a part. "Draw it" is blocked while `parseBrief` fails, naming the broken rule
    (rite/BriefCard.tsx:44-149).
  - II Bind: archetype, voice and palette chips (Marks.tsx:191).
  - III Forge: polling 1.5 s, then 5 s after 60 s, 5 min cap, 3 poll failures end it
    (forge/useForgeJob.ts:17-21,118-152). The "Developing" glass goes static -> portrait -> part
    boxes (rite/RiteGlass.tsx:17-47); a tape shows the stage holds (:129-152).
  - IV Wake: the record is kept to IndexedDB with every layer fetched into a Blob
    (forge/keep.ts:26-38); the face flares and speaks; "Put on air".
- /creator, Anatomy Under Glass (CreatorPage.tsx:66, glass/Anatomy.tsx:60): layer rail
  (toggle/highlight/select), click a part on the glass to edit it, Mood tab (MoodDial fires a
  gesture), Look tab (PaletteCard recolours lights + regions, ShapeCard size/stretch/offset/tilt),
  Face tab (gaze, motion, expression per character, FaceCard.tsx), five voices. The look is
  autosaved 400 ms after the last change (Anatomy.tsx:33,78-87).
- Library: IndexedDB `sr-library` v2 with validate-on-read; damaged records are listed, not
  rendered; in-memory fallback (library/libraryStore.ts:21-25,86-156). Seeded Malakor + cast load in
  the background (library/useLibrary.ts:77-113). .srpack export/import (library/ExportSheet.tsx:51,
  ImportPack.tsx:33, packing.ts:27-44).
- Hand-offs: air stage via `sr.onAir` (air/onAir.ts:13-20), embed (reach/playable.ts:89), overlay
  (reach/overlay/OverlaySetup.tsx:49-53), studio (reach/studio/SourcePicker.tsx:15-20).

**What it does unusually well** (evolve these):
1. A *named-part* decomposition driven by a human-approved brief, so a serpent-haired auntie gets
   serpents that sway, not a generic "hat". A deterministic cutter, plate fill, measured mouth and
   regions stand behind it.
2. Expressions that repaint the face (six families) under a *measured* stability gate, degrading to
   procedural motion instead of failing.
3. A codified, growing body of decomposition craft: the cast-forge ledger's per-character rules
   (docs/cast-forge-ledger.md:7-54, :452+), folded into the live prompt.
4. One code path for the offline cast and the live product (live-proof.mjs), and a replay plane that
   makes every state, including every failure, reachable without keys.
5. Strict wire validation; statuses only move forward; the client never shows a half-built rig
   (forgeClient.ts:11-12, forgeReducer.ts:9-12).

## Measured state

- Tests: `npx vitest run packages/forge apps/web/src/creator api` at aaa2b54 on 2026-11-07:
  **83 files, 809 tests, all pass** (89 s). The forge package has ~289 tests in 38 files, including
  golden pins (cast, emissive, mouth, regions); no .skip/.todo.
- Live forge latency: decision 0003 run 1 (2026-11-01, docs/decisions/0003-forge-spike.md):
  portrait 15.0-15.9 s, parts 13.7-19.6 s per call; 5 of 19 polygons self-intersected. Full live
  end-to-end time with eyes + six expressions: **not measured**. By the step list it is about 10
  sequential model calls (portrait + parts + fill + eyes + 6 expression edits).
- Cost of one full live forge: not measured end to end. By costs.ts it is at least portrait $0.14 +
  fill $0.14 + 6 expressions x $0.14, plus the two eye edits.
- Expression pass rate live: not measured. Offline, the owner's cast-face-pass review (commit
  aaa2b54) reverted three of the recorded cast's faces (Reveille, Tallyman, Vicar) to their main art
  and changed two more: the gate passes faces that a human then rejects.
- Usage / error rates: not measured (no telemetry in the repo).
- There is no lens-scan store, registry map or perfect ledger in this repo.

## Recent history

Last ~90 days: 58 commits touching forge+creator, all since 2026-11-01 (a hackathon sprint).
- 11-01: forge pipeline built (types, masks, cutting, fill, assemble, endpoints, replay plane);
  creator built (forge client, reducers, IndexedDB library, staged progress, gallery, art direction
  "Anatomy Under Glass" / "Rite in Four Marks").
- 11-03: cast-forge tasks 2-12: eight hand-decomposed cast characters, the brief + handshake
  (task 10), live decomposition from the brief (task 11). Character-control: colour regions,
  expression faces, Look tab.
- 11-04: avatar packs (.srpack export/import in the creator); lossless WebP layers.
- 11-06: the rig owns the mouth (measured lips, parting seam, drawn emotional mouth opt-in per
  style); face-control contract (iris layers, eye sockets, face profile); Face tab in the creator;
  socketed eyes + gated faces for all thirteen.
- 11-07: act on the cast-face-pass verdict (the owner reverted or changed five characters' faces).
- No other reverts. No perfect / tiger / scan-sweep ledgers exist, so there are no recorded rejected
  directions, but the steering's out-of-scope list is binding (see Constraints).

## Known limits and open questions

- **Live quality gap vs the cast.** The recorded cast is hand-built with per-character recipes, codex
  edits and eyeballed sheets. The live path has only the generic prompt + automatic gates. How close
  a fresh live forge gets to the cast is not measured. There is no automated quality judge or score
  anywhere (only the likeness check and the stability/drift gates).
- Brief parts fall back to the generic ten when the model's named parts fail twice
  (forge-steps.ts:210-232; UI copy rite/ForgeWake.tsx:67).
- Fill failure silently degrades to blur fill (forge-steps.ts:243-258); eye failure -> `eyes:"none"`;
  expressions -> "procedural" (ForgeWake.tsx:31-49 lists them).
- A brief-mode job is not resumed after reload: `readStoredJob` accepts only mode prompt|image
  (apps/web/src/creator/forge/useForgeJob.ts:41).
- The `imageDraft` model (gemini-3.1-flash-image, $0.04) is defined, but no step uses it
  (api/_lib/gemini.ts:89-91).
- The Rite's tape covers only the first five stages; expressions are not on it
  (rite/RiteGlass.tsx:129-152). On replay, lines use Clerk's voice (glass/SignalCards.tsx:80).
- After forging there is no way to re-run one stage (one expression family, the fill, or one part),
  only "Try again" / "Edit and send again" of the whole job (ForgeWake.tsx:106-124).
- Ledger "Open decisions for the owner" (docs/cast-forge-ledger.md:385-398): event-driven part
  motion (slam, ring, point); 2 Hz float cap; the renderer smooths pixel art; the eye light tints skin
  around painted eyes; parallax backing copies the front part's edge; no gaze-at-speaker in the rig.

## Constraints

- Stack: TypeScript strict ESM, Node 22, pnpm workspaces, React 19 + Vite + CSS Modules, no UI kit.
  Vercel serverless functions under api/ are the only place secrets live (.kiro/steering/tech.md).
- Gates: `pnpm typecheck && pnpm lint && pnpm test`. eslint: no `any`, no `as unknown as`. CSS:
  tokens only (`var(--sr-*)`, role tokens). **400-line file cap.** A fast-check property test for
  every pure module, proven red once on a seeded fault.
- Models are config, not literals (image gemini-3-pro-image / 3.1-flash-image drafts, segmentation
  gemini-3.8-flash, chat claude-haiku-5-5). Tests never call a paid API.
- **Works on first visit with no keys**: replay is the default and labelled RECORDED. Every new paid
  path needs a replay twin and must honour `x-sr-plane: replay` via `planeFromRequest`. The client
  calls `/api/*` only through `apiFetch`.
- JSON.parse of external data only inside a validator (`packages/*/src/validate.ts`). Optional JSON
  fields are omitted, never null. API errors are `{error:{code,message}}` with spec codes.
- The Rig v1 format (docs/rig-format.md) and the .srpack format (docs/pack-format.md) are public:
  extend them compatibly, never break existing packs or the 14 recorded jobs.
- Product non-negotiables: the face is the hero; WCAG AA, >=14px text, a reduced-motion twin for
  every animation; **no real people** (refused_likeness); no third-party marks; horror, not gore;
  every spooky element bound to a real state.
- **Out of scope** (steering): 3D heads, accounts or cloud save, Twitch/OBS integration,
  moderation/simulator/judge parity, voice cloning.
- Work is spec-first with Kiro (.kiro/specs/*). A large feature would get a spec, but proposals here
  should still be concrete enough to build.
