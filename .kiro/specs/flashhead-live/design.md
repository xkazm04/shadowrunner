# Design: flashhead-live

Live Iris on SoulX-FlashHead Lite. Spark: `.spark/Spark/ideas/flashhead-live.md`. Built on `tools/talking-head` (spec `talking-head`).

## Repo law that binds every task
- Keep each file's line endings; write with the Edit/Write tools or bytes. 400-line cap (TS, CSS and Python). Tokens only in CSS; every animation has a reduced-motion twin.
- Secrets never reach the browser: the LLM key is read by the Python server only.
- Shared machine resources are leased: GPU measurement runs take `th`'s GPU lock; each builder's live server or dev server uses its own port; never kill a process you did not start. Check free GPU memory and host RAM before a long run.
- Model licences are read on each weight's card and on every auxiliary model the code loads. Non-commercial terms are a blocker; OpenRAIL is owner-accepted.
- Report blockers with evidence; counter-propose rather than guess.
- Gates: `pnpm typecheck && pnpm lint && pnpm test` green; `uv run pytest` in tools/talking-head green.

## Runtime
- The live server runs in the FlashHead env (`$TH_HOME/envs/realtime-fh`, which has torch and the upstream repo), with `tools/talking-head` on `sys.path`. `uv run th live [--port 8765] [--upscale none|realesrgan|maxine] [--allow-origin <origin>]...` (core CLI) installs `th/live/requirements.txt` into that env once, then spawns the server there.
- Input portrait: Iris's bust crop, the 1024 portrait's box (192,140)-(832,780), passed to FlashHead's pipeline (use_face_crop off). Probe: identity 0.976 vs 0.901 for the default framing.
- FlashHead Lite, 25 fps, 24 new frames per 0.96 s chunk. The stream never stops: with nothing to say, the engine feeds silence and emits idle frames. The task 1 builder measures how silence looks first; if it is stiff, a pre-rendered idle loop is the fallback (report before building it).

## Wire protocol `fhl/1`
WebSocket `ws://127.0.0.1:<port>/live`; `GET /health` on the same port returns `{"ok":true,"proto":"fhl/1"}`.
Origin check: allow `http://localhost:*`, `http://127.0.0.1:*`, plus each `--allow-origin`; others are refused with close code 4403.

Client to server, JSON text frames:
- `{"type":"hello","role":"control"|"out"}`: first message. `out` clients receive media; `control` clients send commands. Any number of each.
- `{"type":"say","id":"<string>","text":"<line>"}`: speak a typed or slide line (queued, FIFO).
- `{"type":"chat","id":"<string>","text":"<message>"}`: conversation turn, LLM, spoken reply.
- `{"type":"stop"}`: drop queued speech and frames not yet emitted; return to idle.
- `{"type":"source","source":"text"|"mic"}`: puppet mode on (`mic`) or off. While `mic`, control sends binary audio (below) and say/chat are refused with an `error` event.
- `{"type":"upscale","kind":"none"|"realesrgan"|"maxine"}`: switch the upscaler at the next chunk.
- `{"type":"slide","index":<int>}` followed by ONE binary slide message: relayed to every `out` client. An EMPTY image (0x13 with no bytes) clears the slide: the server relays it as an empty 0x03 and an `event` `slide` with `text: null` (amendment, 2026-11-16).

Client to server, binary:
- Mic PCM: tag byte `0x10`, then PCM16LE mono 16 kHz samples.
- Slide image: tag byte `0x13`, then the image bytes (PNG/JPEG/WebP).

Server to client, JSON text frames:
- `{"type":"state","ready":bool,"model":"lite","fps":25,"upscale":"<kind>","source":"text"|"mic","queue":<int>,"delayMs":<int>,"size":<px>}` on hello and on every change.
- `{"type":"event","kind":"line-start"|"line-end"|"reply-text"|"slide"|"error","id":<string or null>,"text":<string or null>,"atMs":<number>}`. `atMs` is on the stream clock; `line-start` is the pts of the line's first audio sample; `reply-text` carries the LLM text as spoken, per sentence; `slide` carries the index in `text`.
- `{"type":"timing","id":"<line id>","firstFrameMs":<n>,"chunkMs":<n>,"upscaleMs":<n or null>}`: per line, measured server-side (firstFrameMs = from command receipt to the first video frame of that line leaving the server).

Server to `out` clients, binary (little-endian):
- Video frame: `0x01`, float64 ptsMs, uint16 width, uint16 height, then JPEG bytes (quality 90).
- Audio: `0x02`, float64 ptsMs, uint32 sampleRate, then PCM16LE mono samples. Speech plays at its source rate (Kokoro 24 kHz, mic 16 kHz); silence is not sent.
- Slide: `0x03`, uint32 index, then the image bytes.

Clock and sync: one stream clock (ms since the server started streaming). Frame i of the stream has pts = i * 40. Audio pts is the time of its first sample on the same clock, so lip-sync holds by construction. `out` plays both at pts plus a fixed playout delay (default 250 ms jitter buffer) on a WebAudio clock. Absent values are `null`, with the key always present.

## Interfaces (the Director commits stubs with these exact signatures before the fan-out)
- `th/live/upscale/__init__.py`: `class Upscaler(Protocol): kind: str; scale: int; def warmup(self) -> None; def __call__(self, frames: "torch.Tensor") -> "torch.Tensor"` (uint8 CUDA tensor (N,H,W,3) in, (N,H*scale,W*scale,3) out) and `get_upscaler(kind: str) -> Upscaler` (`none` is identity, scale 1).
- `th/live/chat.py`: `async def reply_sentences(text: str, history: list[dict]) -> AsyncIterator[str]` (yields speakable sentences as they stream) and `def persona() -> str`.
- `th/live/tts.py`: `async def speak(text: str) -> AsyncIterator[tuple[np.ndarray, int]]` (float32 mono chunks, sample rate), sentence by sentence.

## Measurement
`uv run th live-bench --script <id> [--upscale <kind>]` runs the same engine headless (no WebSocket). It writes a normal `th` run dir (raw.mp4 at the output size with the speech audio muxed, video.mp4, run.json with `arm: "live-fh"`) plus `live.json`: per-line firstFrameMs, sustained fps, chunk ms p50/p95, upscale ms p50/p95, dropped chunks. Metrics as `th render` (SyncNet, identity), plus sharpness: variance of the Laplacian on the face crop.

## Work packages
1. **Engine, protocol and bench (Python)**: `th/live/{server,engine,protocol,tts,bench,__main__}.py`, `th/cli.py` (live, live-bench subcommands), tests.
   - FlashHead streaming loop with the bust crop and silence idle.
   - Sources: typed lines via Kokoro sentence streaming, and mic PCM for puppet mode.
   - Stop/interrupt, the upscaler hook, slide relay, timings, live-bench.
   - Wires `chat.reply_sentences` (a stub until task 4).
   - Acceptance:
     - A Python WS client test drives say, then line-start/line-end, with frames and audio pts-aligned.
     - live-bench pitch-45s gives sustained >= 25 fps with upscale none and SyncNet >= 7.
     - The silence-idle look is measured and reported with a sheet.
     - Stop clears within one chunk.
     - The origin check refuses other origins.
   - Owns the `docs/talking-head.md` "Live" section.
2. **Upscalers (Python)**: `th/live/upscale/{realesrgan,maxine}.py` and tests.
   - Real-ESRGAN: SRVGGNetCompact (general-x4v3, output 1024, BSD-3), arch inline with no basicsr, fp16 CUDA.
   - Maxine VFX SR or RTX Video SDK: read the licence first. If the SDK needs an account, has evaluation-only terms or is Linux-only, report and stop.
   - A/B via live-bench: ms/frame p95, sharpness, identity, and temporal flicker (mean abs frame diff on a static-head interval, against none).
   - Doc section to scratch.
3. **Web /live (TS)**: `apps/web/src/live/**`, a `live` page in `apps/web/src/app/pages.ts` and its Shell branch (offStrip; `/live` is control, `/live?out=1` is the OBS view), and e2e against a fake `fhl/1` server (node `ws`).
   - Control page:
     - connection state, with a "start the server" empty state (`uv run th live`);
     - mode tabs: Lines, Chat, Puppet, Slides;
     - an upscaler A/B switch and stop.
   - Out page: canvas plus WebAudio playout by pts, a transparent background, and a slide layout with Iris in a corner while slides are active.
   - Slides: folder input (images sorted by name, plus `script.md` with `## <n>` sections of one or more lines each); advances on the slide's last `line-end`.
   - Puppet: getUserMedia, 16 kHz PCM16, sent as binary 0x10.
   - Doc section to scratch.
4. **Conversation (Python)**: `th/live/chat.py`, `th/live/persona.md`, tests.
   - Anthropic Messages API streaming, key `ANTHROPIC_KEY_LANE_HACKATHON` (server env only), default model `claude-haiku-5-5` (`TH_LIVE_MODEL` overrides).
   - Iris persona from her character data (read `assets/characters/companions/iris/` and the engine's persona conventions).
   - Sentence chunking for TTS, capped history, and a new chat cancels the previous reply.
   - Acceptance:
     - Unit tests with a fake client.
     - One real call measured (first-sentence latency).
     - No key in any client payload.
   - Doc section to scratch.

## Non-goals (v1)
STT voice input, LiveKit/WebRTC, remote viewers, characters other than Iris, the Iris-trained sharpener (follow-up), the Pro model live.
