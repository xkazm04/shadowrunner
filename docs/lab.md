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

## Where WP2-4 plug in

One file per arm; a registry maps each id to a factory. To add an arm, add the file and replace
the arm's one `notBuilt(...)` line in its registry. Every unbuilt slot throws
`<Axis> arm <id> is not built yet: it is <what>. Run with <baseline id>, or add <file> and register it here.`

| Axis | Registry | Entry shape | Built |
|---|---|---|---|
| control (WP2) | `src/director/arms/control/index.ts` | `C1: createC1` with `ControlArmFactory = (ctx: ControlContext) => ControlArm` | C0 |
| lip (WP3) | `src/page/lip/index.ts` | `L1: createL1` with `LipDriverFactory = (ctx: LipContext) => LipDriver` | L0 |
| scene (WP2) | `src/page/scene/index.ts` | `S1: createS1` with `SceneDriverFactory = (ctx: SceneContext) => SceneDriver` | S0 |
| output (WP4) | `src/director/output/index.ts` | `O1: createO1` with `OutputArmFactory = (ctx: OutputContext) => OutputArm` | O0 |

- **ControlContext** (`arms/control/types.ts`): `llm` (the chosen transport), `apiKey?` (api only),
  `fixture?`, `model?`, `voice`, `seed`, `log`. Yield `say` / `emotion` / `gesture` / `scene`
  events with `t: 0` (the director stamps `t`); report `usage()` including `controlErrors` for
  outputs that failed to parse and fell back. The director voices every `say`.
- **LipContext** (`page/types.ts`): `player` (AvatarPlayer), `audio` (`context`, the `output`
  GainNode every utterance plays through, `nowMs()` on the AudioContext clock, `level()`),
  `reducedMotion`. The page calls `onAudio(event, audioStartMs)` when the utterance's first sample
  is scheduled, `onViseme(event)` for each span (relative to that audio start), and `frame(nowMs)`
  every frame after the player has stepped. L0 attaches `audio.output` to the player and ignores
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
