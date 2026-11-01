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
| The "Cellar Exchange" art direction (a design concept chosen in an earlier design contest) | informs `packages/theme`, `apps/web/src/landing` | Overlord design contest, 2026-10 | before 2026-10-30 |
| Rig format shape (layers with bbox/anchor/z) | re-specified in `.kiro/specs/rig-core` | idea from Overlord | - |

## Generated during the submission period
| Item | Tool | Date |
|---|---|---|
| Photoreal cellar plates promoted to `assets/plates/*.webp` (`cellar-wide`, `crt-frontal`, `root-pile`, `root-eye`, `paper`; WebP conversions by Kiro landing task 1 on 2026-11-01). `paper` comes from the round-1 contest plates (see `PROMPTS.md`). | Gemini 3 Pro Image | 2026-10-31 |
| Landing stills: `crt-frontal`, `root-cellar-wide`, `root-pile`, `root-eye` (`assets/_incoming/landing-winner/stills-source/`; prompts in `assets/_incoming/landing-winner/PROMPTS.md`) | Gemini 3 Pro Image | 2026-10-31 |
| Landing prototype The Harvest Floor (`assets/_incoming/landing-winner/`, reference only) | Claude Opus 5.5 via the contest skill, 4 rounds | 2026-10-31 |
| Forge probe overlays (`docs/decisions/0002-*.png`) | Gemini 3.8 Flash / 3.1 Pro | 2026-10-31 |
| Recorded show `assets/replay/shows/malakor-night.json`: 40 fictional audience messages and 24 Malakor lines, original writing in the voice of the bible | Claude Opus 5.5 (Claude Code, voice-and-air task 1.2) | 2026-11-01 |
| Show voice `assets/replay/shows/malakor-night/b00-b23.wav` (24 files, 16-bit mono 24 kHz, 14.4 MB, ~315 s): one run of `scripts/render-show.mjs`, voice `clerk` = Gemini prebuilt `Iapetus`. That run sent a spoken-style prefix that the model read aloud; instead of a second paid run, the prefix was cut locally (boundary from Whisper base.en word timestamps, refined to the quietest gap), the double WAV header unwrapped, the tail trimmed and pauses over 0.6 s shortened. The prefix was removed from `api/_lib/tts.ts` and the script afterwards. | Gemini `gemini-3.8-flash-tts` (owner key); local post-processing with numpy | 2026-11-01 |

Designed and generated art is stylised and labelled as such in the UI; no real person is depicted.
