# Implementation plan: voice-and-air

- [x] 1. Engine contract and scripted engine
  - [x] 1.1 `types.ts`, `voices.ts`, `picker.ts` with properties (never self, never twice).
  - [x] 1.2 Write `assets/replay/shows/malakor-night.json` (fictional audience of ~40 messages, ~24 beats in Malakor's voice from `assets/characters/malakor/bible.md`, generic beats for visitors); `scripted.ts` with the determinism property.
  - _Requirements: 1.1, 1.2_

- [x] 2. Anthropic engine
  - `schema.ts` (REPLY_SCHEMA, `parseReply` with trimming property), `persona.ts`, `anthropic.ts` with injectable fetch; fake-fetch tests for model, schema, chat quoting and limits.
  - _Requirements: 1.3, 1.4, 1.5_

- [x] 3. Engine endpoint
  - `api/engine/reply.ts` using the plane switch and `checkAndCharge(ip, "engine", usd)` from `api/_lib/quota.ts` (created by forge-pipeline task 6.2; if absent, stop and report); tests: replay zero fetches, quota before call, input cut to 20 x 300.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Voice
  - [x] 4.1 `api/_lib/tts.ts` (Gemini TTS -> PCM -> WAV header) and `api/voice.ts` with voice validation and quota kind `voice`.
  - [x] 4.2 `scripts/render-show.mjs` (owner key, not in tests) renders the show's lines to `assets/replay/shows/malakor-night/*.wav`; replay `/api/voice` returns recorded WAVs; provenance noted in `docs/provenance.md`.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Stage page
  - One clock (from the 1.1 review): the stage stamps every chat message, audience and visitor alike, with the same monotonic show clock before it reaches `pickMessage`, and passes `ctx.self` equal to the name the character's replies are posted under. Test: a visitor message typed in the same millisecond as a pick is still answered on the next beat.
  - [x] 5.1 `useLoudness.ts` (AnalyserNode RMS -> jawOpen with attack/release) with a unit test on synthetic buffers.
  - [x] 5.2 `useShow.ts` beat loop (pick -> reply -> voice -> play -> captions), TTS failure -> caption only, one retry.
  - [x] 5.3 `AirPage.tsx`, `Chat.tsx` (visitor input), `OnAirLamp.tsx`, `Captions.tsx`, `air.module.css` with role tokens only; register `air` in the page manifest as `live`.
  - _Requirements: 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 6. Haunt bound to status
  - Stage state machine with `dead_line` (`DeadLine.tsx`), health polling, fog from chat velocity via `--sr-haunt-fog`, reduced-motion twins, baseline theme check; component tests for enter/recover and the lamp role.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
