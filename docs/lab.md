# Avatar Lab (`apps/lab`)

The lab runs one seeded chat scenario through a chosen set of **arms** (control, lip, scene,
output) and writes everything a comparison needs into one run folder. Every arm on every axis
compiles into the same event timeline (`apps/lab/src/contract.ts`, Director-owned), so arms can be
swapped one factor at a time and any run can be re-rendered later with no model and no TTS.

```
var/lab/runs/<runId>/
  config.json      the RunConfig (arms, scenario, seed, replayOf)
  timeline.jsonl   every event the director emitted, one per line, t = ms from run start
  audio/<id>.wav   each utterance, 16-bit mono (Kokoro: 24 kHz)
  run.webm         O0: the composited 1920x1080 stage + the audio mix (VP9/VP8 + Opus)
  metrics.json     ttfaMs, turnLatencyMs, fpsP50/P5, droppedFrames, cpuPct, tokens/cost,
                   controlErrors, sceneOps, renderBackend, durationS (unmeasured keys omitted)
```

## Set up

Node 24 and pnpm (root `pnpm install`), Python 3.12 (uv preferred), and for live runs either
`ANTHROPIC_API_KEY` or a logged-in `claude` CLI.

```
pnpm lab setup        # tools/lab-voice/.venv + Kokoro models into var/lab/models/ (~350 MB)
cd tools/lab-voice && .venv/Scripts/python -m unittest     # phoneme->viseme map, no model needed
```

The first run also builds the theme CSS and the cast packs if they are missing (the same steps as
`pnpm dev`). Playwright's Chromium is the one apps/web already installs.

## Run

```
pnpm lab run --config baseline --scenario haunt-01            # headed Chromium, live model
pnpm lab run --headless                                       # GPU flags first, SwiftShader fallback
pnpm lab run --control-fixture                                # recorded replies, no model at all
pnpm lab run --config '{"lip":"L1"}' --seed 7 --debug         # one arm swapped; event list on screen
pnpm lab run --time-scale 0.3                                 # chat arrives 3x sooner (debugging)
pnpm lab replay <runId> [--headless]                          # zero LLM, zero TTS
pnpm lab fixture <runId>                                      # that run's replies -> <scenario>.fixture.json
pnpm lab help
```

`--config` takes `baseline`, inline JSON, or a JSON file; its fields override BASELINE
(C0 L0 S0 O0). `--llm api|cli` picks the transport (default `api` when `ANTHROPIC_API_KEY` is set,
else `cli`); `--model` the control arm's model (default `claude-haiku-5-5`, the product engine's).

**Replay** reads the source run's `config.json`, `timeline.jsonl` and WAVs, re-emits every event at
its recorded `t` (PCM before each audio event) and records a new run with `replayOf` set. It never
asks for a control arm or a voice (`replay.test.ts` passes factories that throw and asserts zero calls).

## How a run flows

1. The director (Node, `src/cli.ts`) validates the config and builds the control arm first, so an
   unbuilt slot fails with its sentence before anything opens. It starts the Kokoro sidecar.
2. It serves `src/page` with Vite (packs from `apps/web/public/packs`), opens the lab WebSocket on
   its own port, and the output arm opens the page in Playwright Chromium (1920x1080, DPR 1).
3. The page loads the pack (`@sr/pack`), mounts `createAvatarPlayer` (`@sr/avatar/core`), creates
   the lip and scene drivers from its registries and answers `ready{renderBackend}`.
4. The director plays the scenario on its clock: each chat message emits `turn`, then runs one
   control-arm turn (turns queue; `mark play:<n>` notes when turn n's output starts). Each `say`
   goes to Kokoro; the director writes the WAV, sends `pcm`, emits `audio` and the `viseme` spans.
5. The page schedules each utterance on the AudioContext clock and reports `audioStarted` (the
   latency metrics use it) and `frameStats` every second. After the last utterance has played the
   director sends `end`, the output arm stops and the recording is uploaded.

The control arm runs in Node only: the key never reaches the page bundle, which receives text, PCM
and events.

## The LLM seam (`src/director/llm/`)

`complete({ system, messages, schema?, tools?, stream, model? })` returns an async iterable of
chunks: `text`, `jsonDelta`, `json` (structured output), `toolCall`, `usage` (tokens, cost when
known), `stop`.

- `api`: `@anthropic-ai/sdk` Messages, streaming; `schema` -> `output_config.format`, `tools` are
  real client tools (with `eager_input_streaming`). Cost from list prices in `llm/types.ts`.
- `cli`: `claude -p --output-format stream-json --verbose` in an empty folder with `--tools ""`,
  `--setting-sources ""` and `--strict-mcp-config`, so only our prompt runs. `schema` ->
  `--json-schema`; cost is the result line's `total_cost_usd`. **Tools:** the CLI cannot declare
  client tools, so `tools` are emulated: the request becomes a JSON schema
  `{ text?, calls: [{ name, input }] }` whose items are `anyOf` the tools' input schemas, and each
  call comes back as a `toolCall` chunk (ids `cli-call-<n>`). Verified live with two tools. Unlike
  real tool use, calls arrive together at the end and there is no tool_result round trip inside one
  `complete()`; an arm that needs one makes a second call with the results in `messages`.

C0 does not call `complete()` directly: it runs `@sr/engine`'s `AnthropicEngine` unchanged (persona
prompt, `REPLY_SCHEMA`, `parseReply`) and swaps only the wire under it: the engine's own fetch with
the key (`api`), `llm/messagesFetch.ts` (`cli`, answers the Messages body through the transport),
or the fixture.

## Adding an arm

One file per arm; a registry maps each id to a factory. To add an arm, add the file and replace
the arm's one `notBuilt(...)` line in its registry. Every unbuilt slot throws
`<Axis> arm <id> is not built yet: it is <what>. Run with <baseline id>, or add <file> and register it here.`

| Axis | Registry | Entry shape | Built |
|---|---|---|---|
| control (WP2) | `src/director/arms/control/index.ts` | `C1: createC1` with `ControlArmFactory = (ctx: ControlContext) => ControlArm` | C0, C1, C2 |
| lip (WP3) | `src/page/lip/index.ts` | `L1: createL1` with `LipDriverFactory = (ctx: LipContext) => LipDriver` | L0, L1, L2 |
| scene (WP2) | `src/page/scene/index.ts` | `S1: createS1` with `SceneDriverFactory = (ctx: SceneContext) => SceneDriver` | S0, S1 |
| output (WP4) | `src/director/output/index.ts` | `O1: createO1` with `OutputArmFactory = (ctx: OutputContext) => OutputArm` | O0, O1 |

- **ControlContext** (`arms/control/types.ts`): `llm` (the chosen transport), `apiKey?` (api only),
  `fixture?`, `model?`, `voice`, `seed`, `log`. Yield `say` / `emotion` / `gesture` / `scene`
  events with `t: 0` (the director stamps `t`); report `usage()` including `controlErrors` for
  outputs that failed to parse and fell back. The director voices every `say`.
- **LipContext** (`page/types.ts`): `character` (pack id), `mouth` (`Rig.mouth`, when measured),
  `player` (AvatarPlayer), `audio` (`context`, the `output` GainNode every utterance plays through,
  `nowMs()` on the AudioContext clock, `level()`), `reducedMotion`, `addPainter(painter)` (paints
  into the recorded composite after the avatar). The page calls `onAudio(event, audioStartMs)` when
  the utterance's first sample is scheduled, `onViseme(event)` for each span (relative to that audio
  start), `onEmotion(value)` after `player.setEmotion`, and `frame(nowMs)` every frame BEFORE the
  player renders. L0 attaches `audio.output` to the player and ignores
  visemes; an arm that sets the mouth itself should not attach the audio.
- **SceneContext**: `stage` (the 1920x1080 element), `audio`, `reducedMotion`, `onFrame(hook)`,
  `addPainter("back" | "front", painter)`. **O0 records a canvas, not the DOM**: anything a scene
  shows must also be painted through `addPainter` to reach `run.webm`. S0 shows a CSS light live
  and paints the same light into the composite.
- **OutputContext** (`output/types.ts`): `runId`, `headless`, `server` (the stage: `send`,
  `awaitUpload(runId, file)`), `launch(url)` (Playwright stage; returns `page`, `cpuSeconds()`,
  `close()`), `onStage(stage)` (hand the stage back so the director samples CPU), `log`. O0 adds
  `record=webm` to the page URL; the page exposes `window.__labStopRecording()`.
- **Metrics** (WP4): `metrics.ts` `computeMetrics` omits what was not measured; `avOffsetMs` is
  WP4's (from the recorded file) and is never written here. The page's `audioStarted.atMs` is on
  the AudioContext clock; latency uses the director's receive time.

## Control arms C1 and C2 (`src/director/arms/control/`)

Both use C0's persona (the engine's `personaPrompt`, with its "one spoken line, no stage
directions" rule swapped for the arm's direction channel, `prompts.ts`), C0's quoted chat window,
and C0's default model (`claude-haiku-5-5`). `usage()` meters tokens and cost like C0.
`--control-fixture` works for both: each recorded reply is fed through the arm's own channel
(C1: written as tags and parsed; C2: as emote/gesture/say calls), so no model is called.

**C1 - inline cue grammar, streamed** (`c1.ts`, `cues.ts`). One plain-text `complete()` with
`stream: true`. The model writes speech with tags in square brackets:

```
[smug 0.7] Name recorded. [gesture nod] [light warm] Do not wander off.
[<emotion>] | [<emotion> <0-1>] | [emotion <name> <0-1>]
[gesture <name>] | [<gesture>]            (lean_in may be written "lean in")
[scene <op> ...] or [<op> ...]:  light dim|warm|cold|flicker|blackout,  candles burst|dim|steady,
  caption plain|whisper|shout,  card show <id> [| title [| body]],  card hide <id>,
  poll open <question> | <option> | <option> (2-4),  poll close
```

`CueStream` parses chunk by chunk: a sentence becomes a `say` as soon as its terminator and the
following whitespace (or a tag) arrive, so Kokoro starts on sentence one while the model writes
sentence two. A tag's event is emitted before the sentence it precedes. Unknown or malformed tags,
a stray `]`, a `[` with no `]` within 200 characters and a tag open at turn end are dropped and
counted in `controlErrors`; their text never reaches a `say`. A failed transport or a turn with no
spoken line counts one more. Say ids are `say-<chatId>-<n>`.

**C2 - tool calls** (`c2.ts`, `tools.ts`). Tools `say(text)`, `emote(emotion, intensity?)`,
`gesture(name)`, and one per scene op: `light(cue)`, `candles(action)`, `card(action, id, title?,
body?)`, `caption(style)`, `poll(action, question?, options?)`. Enums come from the contract
(`vocab.ts`, compile-time checked against `SceneArgs`). Limits are stated in descriptions, not
schema keywords, and enforced by `validateCall`: unknown tool, bad enum, missing/empty text,
intensity outside 0..1, a card id that is not one word, a poll opened without a question and 2-4
options -> skipped and counted in `controlErrors`. C2 yields each `toolCall` chunk as it arrives;
over `cli` they all arrive at turn end (schema emulation), over `api` after the message completes
(see `apiTransport.ts`). No tool_result round trip.

Emotion intensity (both arms) is parsed and validated, but the contract's `emotion` event has no
field for it, so it is not carried.

## Scene arm S1 (`src/page/scene/s1.ts`, `s1/`)

`s1/model.ts` is the pure state: `apply(op, nowMs)`, `utter(line)` (from `onUtterance`) and
`sample(nowMs, speech)` -> one `SceneFrame` per frame. The live DOM view (`s1/view.ts`,
`s1.module.css`) and the recorded painters (`s1/paint.ts`, `addPainter("back" | "front")`) both
draw that same frame.

| Op | What it does |
|---|---|
| light dim/warm/cold/flicker/blackout | backlight eases (900 ms; blackout 250 ms) between looks: brightness, warm (ember) vs cold (phosphor-2) mix, darkness over the stage; flicker drops out on a 60 ms step |
| candles burst/dim/steady | six painted candles at the stage edges, unlit until the first op; burst spikes and settles, flames sway |
| card show/hide | paper card top left (title, body); a hide with another id is ignored |
| caption plain/whisper/shout | every spoken line is captioned at the bottom from its audio start to 700 ms after its end, in the style in force when it was scheduled |
| poll open/close | panel top right with numbered options; close shows "POLL CLOSED" for 1.5 s, then fades |

Reduced-motion twin: eases become cuts, no flicker, no flame sway or burst spike, no shout shake,
no speech-following light. Recording runs force motion on. Colours and fonts are theme roles read
once from the stage (`s1/palette.ts`); the CSS uses tokens only, laid out at half size and scaled
2x so the type scale reads on the 1920x1080 stage.

## Lip arms L1 and L2 (WP3)

Both arms share one driver body (`src/page/lip/mouth/driver.ts`). Neither attaches the stage audio
to the player: they hand the player a shape mix (`player.setMouthShapes(weights, { jaw, drawn? })`)
and `@sr/avatar` moves the mouth itself, on `Rig.mouth`, with the character's emotion (main.ts
hands it over with `setEmotion`). What the player does with the mix depends on the rig
(`player.mouthMode()`, from `mouthMode(rig.mouth)` in `@sr/avatar`):

- `"warp"` (the default for a measured mouth): the GL renderer bends the character's own painted
  lips (corners, opening over a dark interior; spark art-mouth). The Canvas2D fallback slides the jaw.
- `"drawn"` (`Rig.mouth.render: "drawn"`, the Tallyman): the player paints its procedural mouth.
- `"still"` (`render: "still"`), or no `Rig.mouth`: shapes are not sent; the driver opens only the
  jaw, through `player.setLevel`, and warns once at creation.

**Frame order.** The page calls `lip.frame(nowMs)` BEFORE `player.renderFrame`, so the mix set at
`nowMs` is drawn in the same frame, and L2's painter pairs that mix with the player's alpha from the
same frame. The jaw mix is read 30 ms ahead (`JAW_LEAD_MS`), because the jaw eases toward its target.

**Scheduler** (`mouth/track.ts`, `mouth/shapes.ts`). The 15 Oculus visemes are grouped into eight
shapes: rest (sil), closed (PP), teeth (FF), tongue (TH, DD, nn), openMid (kk, E), narrow (CH, SS, ih),
round (RR, oh, ou), openWide (aa). A span waits until its utterance's audio start is known
(`onAudio`), then becomes a window on the audio clock. Each span's weight rises over `BLEND_MS`
(50 ms) centred on its start and falls over 50 ms centred on its end (smoothstep edges), so
neighbours crossfade with no hard cut. Rest takes whatever weight is left. The shape parameters
(`SHAPE_PARAMS`, width, open, round, teeth, tongue, press, jaw) live in `@sr/avatar`. A line that
arrives with no visemes falls back to the speech level (a mid-open mouth as loud as the line).

**Where the mouth is.** `Rig.mouth` (`cx`, `lineY`, `width`, optional `lips` box), measured by the
forge and back-filled for the cast by `scripts/cast/mouth-backfill.mjs`. L2 recomputes the anchor
from `player.layerFrames()` (the renderer's own affines) to draw in the head's frame.

**L1** is the driver alone: the player moves the mouth (warp or drawn, per rig).

**L2, forge mouths.** `pnpm lab mouths <character>
[--placeholder] [--draft] [--model id] [--only shape,...]` writes `var/lab/mouths/<character>/`:

- `rest.png`: the face layers at rest, cropped to a square around the mouth;
- one PNG per other shape;
- `manifest.json`: the crop in rig px, shape to file, and the source;
- `cost.json`.

Without `--placeholder` the command calls Gemini from Node: seven image edits of the rest crop, at
the forge's request shape and price (0.14 USD each, 0.04 with `--draft`). It stops with a sentence,
before any read or write, when `GEMINI_API_KEY` is unset. A shape the model refuses is left out
(`failed` in the manifest). `--placeholder` draws flat stand-in shapes on the crop with ffmpeg
(deterministic, no model call, cost 0). The page finds sets with `import.meta.glob` when the stage
starts, so a set generated later needs a new run.

At runtime L2 cuts each shape image by the rest crop's alpha and a feathered ellipse, crossfades the
shapes by their weights, and paints the mix into the recorded composite (`LipContext.addPainter`)
in the head's frame. The player draws only the shapes the set lacks (`drawn`), and the jaw opens only
for those (`jawWeights`), because the art carries its own opening. With no set for the character, L2
fails at creation with the command to run.

**Reduced motion.** When the viewer asks for reduced motion and the run does not force motion, the
mouth does not articulate per viseme. While a line plays it eases (150 ms) to one soft, half-open
shape, and back to rest after the line. Recording runs force motion, as for every arm.

**Known limits.**

- L2 paints only into the recording; the live canvas shows the player's mouth.
- L2's Gemini art is unverified here: there is no key on this machine. Only the placeholder set has
  been run.

## Output O1: the streamed path (`src/director/output/o1.ts`, `o1/`)

O1 sends the stage through a real streaming chain: Playwright Chromium -> MediaRecorder -> ffmpeg
publisher -> RTMP -> a local ffmpeg sink. The sink writes `run.flv` in the run folder. Nothing
leaves 127.0.0.1: the publisher only ever targets the sink it started.

```
page (record=webm composite + stage audio)
  -> MediaRecorder, live chunks every 250 ms (Matroska H.264 + Opus; WebM VP8 when H.264 is missing)
  -> Playwright binding __labO1Chunk -> director
  -> ffmpeg publisher stdin: H.264 (h264_nvenc, else libx264 veryfast) CBR 6 Mb/s, keyframe every 2 s,
     AAC 160 kb/s 48 kHz, frame timing passed through (no CFR resampling)
  -> rtmp://127.0.0.1:<free port>/live/lab
  -> ffmpeg -listen 1 sink, stream copy -> run.part<n>.flv -> run.flv
```

- **No page change.** An init script (`o1/capture.ts`) replaces `MediaRecorder` before the page
  runs. The page's O0 recorder becomes inert, so the whole run is not buffered in memory. The
  stream the page hands it is recorded live instead, with a keyframe every second
  (`videoKeyFrameIntervalDuration`), so a restarted publisher can join at the next Cluster.
- **Why MediaRecorder and not a CDP screencast.** The screencast's video is good (59.4 fps, dt p95
  16.8 ms on a 1080p canvas page) but it has no audio. Adding audio would mean a second channel
  and aligning two clocks in Node, and that alignment error lands exactly in the A/V offset the
  lab measures. The recorder muxes picture and sound on the browser's own media clock.
- **Publisher death.** When the publisher exits, the sink closes its segment. O1 then opens a new
  sink and publisher, feeds them the stream's init segment and continues from the next Cluster,
  counts a reconnect, and records the marks `o1:publisher-died:<code>` and `o1:reconnect:<n>`.
  The segments are joined on the recorder's own clock (ffconcat `duration` from the Cluster
  timecodes), so the outage stays a gap in the timestamps: measure counts it as dropped frames.
- **`o1.json`** sits next to `run.flv`: encoder, settings, the page's container, chunks, bytes,
  out-of-order chunks (should be 0), segments, reconnects, and marks with their wall time.
- `SR_LAB_FFMPEG` overrides `ffmpeg` on PATH.

### Long runs without a model or TTS: `loop`

```
pnpm lab loop <runId> --times 5 --output O1
pnpm lab replay <runId>-x5-O1 --headless
```

`loop` writes a replay source that plays a recorded run's timeline N times back to back. Each
copy shifts by one period (the last audio's end plus 3 s), renumbers its turns and play marks,
and suffixes its utterance and chat ids. The replay then exercises O1 for 10+ minutes with zero
LLM and zero Kokoro calls. This is the fixture control at its cheapest: the output is what is
under test, not the reply.

## Measure: numbers from the recorded file alone (`src/measure/`)

```
pnpm lab measure <file> [--roi x,y,w,h] [--run <runId>]
pnpm lab synth <out.flv|out.webm> [--offset 120]
```

Measure reads only the file: `run.webm`, `run.flv`, `run.mp4`, or any capture. That makes it the
same instrument for every renderer, Overlord included. Results:

- `fpsP50`, `fpsP5` and `droppedFrames` come from video packet timestamps (ffprobe), using the
  page meter's method: per-frame `1/dt`, and a frame interval over 1.5x the median counts its
  missing frames. Measure never trusts a duration header, since MediaRecorder WebM has none.
- `avOffsetMs` is the lag in ±500 ms (1 ms steps) that maximises Pearson r between two signals:
  - mouth-region motion energy: the mean absolute difference between consecutive gray frames
    inside the ROI;
  - the change of the audio RMS envelope over the same frame interval, `|E(t_k) - E(t_{k-1})|`,
    where `E` is the RMS over a frame-long window centred on `t`.
  Positive means the mouth lags the audio. Change is compared with change because the mouth
  moves fastest while the level rises, not while it is high, so correlating motion with the
  level itself biases the lag by about a quarter syllable. A window that ends at `t` would bias it
  by half a frame (the synthetic test caught that: 103 instead of 120).
- Measure merges these four keys into the run's `metrics.json` and writes `measure.json` beside
  it. `measure.json` holds the ROI and its source, the frame interval, the sync result
  (`peakR`, `runnerUpR` = the best r at least 100 ms away, `z`, `confidence`, `frames`), and in
  `replaced` the page meter's fps and drop values that the file-based ones overwrote.
- Confidence:
  - **high**: `peakR >= 0.5` and a margin over the runner-up of at least 0.1;
  - **medium**: `peakR >= 0.25` and a margin of at least 0.05;
  - **low**: anything else. Treat a low-confidence offset as unmeasured.
- **ROI.** Lab runs get it automatically. Measure takes the union of the cast rig's jaw layer
  bboxes (`assets/replay/forge/<id>/job.json`, the rig the pack is built from), grows it by the
  jaw's full drop below and margins around, and maps it through the player's contain-fit onto
  the 1920x1080 stage, then onto the file's resolution. `measure-roi.png` shows the ROI on the
  frame with the most mouth motion, for a check by eye. External runs need `--roi`.
- **Validation.** `synth` encodes a box "mouth" that follows a seeded speech-like envelope, plus a
  220 Hz tone on the same envelope, shifted by `--offset`. Measure recovers +120 → 119 (FLV,
  H.264/AAC) and 120 (WebM, VP9/Opus), -80 → -81/-80, and 0 → -2/-2. The FLV case also runs in
  `measure.test.ts` whenever ffmpeg is present.

## Overlord baseline (`src/overlord/`)

Overlord (`C:\Users\kazda\kiro\overlord`) runs as a black box, from its own build. The lab never
writes into that repo: runs, data and logs go to a folder you choose.

**The input differs.** Overlord has no way to take haunt-01's chat:
- sandbox chat comes only from its simulated room;
- Twitch chat feeds only the moderator;
- no RPC op injects viewer chat;
- `--scripted` replaces the LLM, not the room.

The baseline is therefore a scripted 5-minute sandbox session, recorded for haunt-01's length
(125 s). `config.json` says so: `external: "overlord"`, `inputDiffers: true`, and a `note`.

### Runbook (about 10 minutes once; 3 minutes for each run after that)

1. Build: `cargo build --release -p shadowrunr-daemon` in the Overlord repo (2 m 45 s cold). This
   writes only `target/`. The stage needs `node_modules` in that repo, which is already installed.
2. Write a `shadowrunr.toml` outside the repo, as a copy of its own, with these changes:
   - `[engine] scripted = true`;
   - `[paths]`: `characters`, `policy`, `sim` and `segments` as absolute paths into the repo;
     `runs` and `data` pointing to your folder;
   - copy the repo's `data/` into your folder (small), with `data/avatar` as a junction to the
     repo's `data/avatar` (398 MB, read only);
   - a `[voice]` section using the installs already on this machine:
     ```toml
     [voice]
     enabled = true
     python = "C:/Users/kazda/.shadowrunr/venvs/voice/Scripts/python.exe"   # sherpa-onnx 1.13.8
     sidecar = "C:/Users/kazda/kiro/overlord/tools/voice"
     engine_dir = "C:/Users/kazda/.personas/companion-tts"                  # kokoro/ = kokoro-multi-lang-v1_0
     durations_model = "C:/Users/kazda/.shadowrunr/models/kokoro-durations.onnx"
     voices_dir = "C:/Users/kazda/.shadowrunr/voices"                       # malakor-voices.bin
     ```
3. Check: `shadowrunr --config <toml> preflight --scripted` should show no red (PF-06 and PF-08 are
   amber), and `shadowrunr --config <toml> voice check` should end with "ready to speak, with
   mouth shapes".
4. Run (from the worktree root):
   ```
   pnpm lab overlord --toml <toml> [--seconds 125] [--seed 1031] [--headed]
   pnpm lab measure var/lab/runs/<runId>/run.flv --roi 240,390,200,130
   ```
   The command:
   - starts the daemon (`--scripted`, port 7717, `--port`) and the stage dev server (port 5178,
     `--stage-port`);
   - calls `sandbox.start {minutes: 5, seed, judge: false}`;
   - opens `http://localhost:5178/?run=live&broadcast=1&voice=1` (use `localhost`: the daemon
     checks the origin) in Chromium with `--auto-accept-this-tab-capture`;
   - captures for `--seconds`, then calls `sandbox.stop` and stops both processes.

   The run folder holds `run.flv`, `o1.json`, `config.json`, `timeline.jsonl` (chat as `turn`
   events, host lines as `say`, on the recording's clock) and `overlord/` (the session's
   transcript, voice log, spec). `240,390,200,130` is Malakor's jaw on the 1920x1080 stage.

**Capture.** It is O1's path with a different source. Overlord's stage is a DOM layout around a
WebGL face, so there is no single canvas to record:
- **Video:** a tab capture (`getDisplayMedia`, current tab). Never pass
  `--use-fake-ui-for-media-stream`: with it, Chromium captured the desktop instead of the tab.
- **Audio:** headless tab audio is silent (-91 dB measured). The audio is tapped instead from a
  `MediaStreamDestination` on the page's own AudioContext, fed by whatever the page connects to
  its speakers. This is the same tap the lab stage records, and it stays in one context, so no
  extra hop shifts A/V.
- **Voice:** the stage never voices an automated browser (`navigator.webdriver`), so the capture
  script reports `webdriver` as false. Nothing else on the page is changed.

## Verdict board export (`src/board/`)

```
pnpm lab board --pairs <runA>:<runB>[,<runC>:<runD>...] [--clip 20] [--seed n]
```

This writes `var/lab/board/<boardId>/`, containing `p<n>-x.mp4`, `p<n>-y.mp4` and `manifest.json`:

```json
{ "boardId": "...", "pairs": [{ "pairId": "p1", "axis": "lip", "clips": { "x": "p1-x.mp4", "y": "p1-y.mp4" },
  "hidden": { "x": "<runId>", "y": "<runId>" }, "moment": { "by": "chat", "chatId": "c3", "startS": { "x": 31.018, "y": 31.017 }, "clipS": 20 } }] }
```

- **Clips.** Both runs are cut at the same scenario moment: a chat both answered (their `turn`
  events), chosen with the seed from those that leave a full clip in both runs. A pair with no
  shared chat (an external run) is cut at each run's first spoken line (`by: "first-line"`).
  Clips are H.264 + AAC MP4 at 1280 px, no more than 20 s, metadata stripped. They are
  re-encoded at a lower bitrate until they fit in 5 MB (about 3.8 MB at 1.6 Mb/s for 20 s).
- **Order and labels.** The x/y order is seeded-random per pair (sha256 of seed and pair). `axis`
  names the arm keys that differ (`lip`, `control+scene`, `external`, `same`).
- The seed defaults to a hash of the pairs, so the same command gives the same board.

## Page query parameters

`ws=<port>` (set by the director), `run=<runId>`, `debug=1` (live event list; its fade honours
prefers-reduced-motion), `record=webm` (O0), `motion=force` (ignore prefers-reduced-motion; set
whenever recording, so every arm is measured with motion on).

## Known limits

- MediaRecorder WebM carries no duration in its header (players show N/A until the end); WP4's
  measurements read packets, not the header.
- `cpuPct` is the whole Chromium process tree (CDP `SystemInfo.getProcessInfo`), percent of one
  core, over the played part of the run; the director, Vite and Kokoro are not included.
- Kokoro runs on CPU in the sidecar; a 10 s line takes about 3 s to synthesise, which is part of
  every turn's latency.
