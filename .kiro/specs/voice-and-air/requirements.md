# Requirements: voice-and-air

## Introduction
The payoff of the creator: the character speaks and goes **on air**. `packages/engine` defines the
`Engine` seam with a deterministic `ScriptedEngine` (replay, the default) and an `AnthropicEngine`
(live). `api/engine` and `api/voice` are thin, quota-guarded doors. `apps/web/src/air` is the
on-air stage: the avatar centre, the ON AIR lightbox as the brightest element, a chat column, and
haunt bound to status (the bulb dies when the engine is offline; fog follows chat velocity).
Quota comes from the shared `api/_lib/quota.ts` created by `forge-pipeline`.

## Requirement 1: The Engine seam
**User story:** As the stage, I want one interface for scripted and live replies, so that replay and live are indistinguishable to the UI.

#### Acceptance criteria
1. `packages/engine` SHALL export `Engine`, `EngineRequest`, `EngineReply`, `ChatMsg`, `Persona` exactly as in design.md, using `Emotion` and `Gesture` from `@sr/rig`.
2. `ScriptedEngine` SHALL answer from `assets/replay/shows/malakor-night.json` deterministically for a given seed and beat index (property).
3. `AnthropicEngine` SHALL call the Messages API with the model from `SR_ENGINE_MODEL` (default `claude-haiku-5-5`) and a structured-output JSON schema in which every object has `additionalProperties: false` and no min/max/length constraints (limits restated in descriptions).
4. `parseReply` SHALL validate engine output; a line over 250 characters SHALL be trimmed at the last sentence boundary within 250; an unknown emotion SHALL become `neutral`; a malformed reply SHALL raise `upstream`.
5. The persona prompt SHALL be built from the character's bible and name; chat text SHALL be quoted as data, never as instructions.

## Requirement 2: Engine endpoint
**User story:** As the owner, I want live replies capped, so that a busy demo cannot run up a bill.

#### Acceptance criteria
1. `POST /api/engine/reply` SHALL accept `EngineRequest` and return `EngineReply` or `{ error: { code, message } }`.
2. WHEN the plane is `replay` THEN it SHALL use `ScriptedEngine` and make no network call.
3. WHEN live THEN it SHALL call `checkAndCharge(ip, "engine", usd)` before the API call and fail with `quota` when exhausted.
4. The request SHALL carry at most the last 20 chat messages, each at most 300 characters; longer input is cut, not rejected.

## Requirement 3: Voice
**User story:** As a streamer, I want to hear my character, so that it feels alive.

#### Acceptance criteria
1. `POST /api/voice { text, voice }` SHALL return `audio/wav` synthesised with Gemini TTS (`SR_TTS_MODEL`), for `voice` in the fixed `VOICES` list in design.md; other values fail with `bad_input`.
2. Text SHALL be at most 300 characters; quota kind `voice` SHALL be charged before the call.
3. WHEN the plane is `replay` THEN the show's lines SHALL play pre-rendered WAVs from `assets/replay/shows/malakor-night/*.wav` and `/api/voice` SHALL return the recorded WAV for a known line or a recorded fallback phrase.
4. IF TTS fails THEN the stage SHALL show the line as a caption and keep the mouth closed, and SHALL NOT retry more than once.

## Requirement 4: The on-air stage
**User story:** As a viewer, I want a stage that reads at a glance, so that I know who is talking and whether we are live.

#### Acceptance criteria
1. The `air` page SHALL render the selected character's rig (via `@sr/avatar`) at centre, the ON AIR lightbox, captions, and a chat column with a visitor input box.
2. The ON AIR lightbox SHALL be the brightest element when on air (luminance check in a component test against role tokens).
3. Each beat (default 9 s, or when the previous line's audio ends) SHALL pick at most one chat message by the picker in design.md and request one reply.
4. The mouth SHALL be driven by the audio element's loudness (Web Audio `AnalyserNode`, RMS -> `jawOpen`), and the reply's `emotion`/`gesture` SHALL drive the avatar's look.
5. On replay the simulated audience SHALL post scripted messages from the show file; the visitor's own messages SHALL be eligible for picking.
6. Captions SHALL be at least 14 px equivalent with AA contrast.

## Requirement 5: Haunt bound to status
**User story:** As a judge in the Costume Contest, I want the spooky elements to mean something, so that the design enhances the function.

#### Acceptance criteria
1. WHEN `/api/health` fails or the engine errors twice in a row THEN the stage SHALL enter the **dead line** state: the bulb goes out, ON AIR goes dark, the face dims to its eye glow, and a "LINE DEAD - reconnecting" caption shows; recovery SHALL be automatic when health returns.
2. Fog density SHALL follow chat velocity (messages per 30 s, smoothed) through `--sr-haunt-fog`, clamped to [0, 1].
3. Every haunt animation SHALL have a reduced-motion twin (static state, no flicker).
4. The baseline theme SHALL render the same states with haunt tokens at zero.
