<div align="center">

# Shadowrunner

**Forge an AI co-host in a cellar you shouldn't have opened.**

Describe a character or upload a picture. Shadowrunner turns it into a living 2.5D face, cut into
layers, lit, breathing and blinking. Dress it, give it a voice and put it on air. Then take it
anywhere: your own site, your OBS stream or a video.

[![Kiroween 2026](https://img.shields.io/badge/Kiroween_2026-Costume_Contest-ff7a18)](#how-it-is-built)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white)](#quickstart)
[![pnpm](https://img.shields.io/badge/pnpm-11.3-F69220?logo=pnpm&logoColor=white)](#quickstart)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#project-layout)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

Demo: _pending_ · Video: _pending_

</div>

---

## Contents

- [Features](#features)
- [Pages](#pages)
- [Quickstart](#quickstart)
- [Replay and live](#replay-and-live)
- [Avatar packs](#avatar-packs)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Deploy](#deploy)
- [How it is built](#how-it-is-built)
- [Provenance](#provenance)
- [License](#license)

## Features

### 🕯️ Forge a character
- **From words or a picture.** A rough request becomes a detailed character brief. You approve it
  (the handshake), and the forge paints a house-style portrait.
- **Cut into a living rig.** The portrait is split into named parts (head, eyes, jaw, hair,
  ornaments) with pivots, depth and their own motion, as a layered **Rig v1**. The format is
  documented in [docs/rig-format.md](docs/rig-format.md).
- **Six expression faces and colour regions**, generated with every forge, so moods and recolours
  change the actual painting.

### 🎭 Bring it to life
- **A hand-written WebGL2 renderer** with a Canvas 2D fallback. It does parallax, blinks, gaze,
  micro-saccades and floating parts, and the jaw follows the voice's loudness.
- **The Look:** recolour the lights while keeping the painted shading, recolour regions (a hood, a
  crown), and reshape any part (size, stretch, offset, tilt).
- **Moods and gestures:** ten moods crossfade between six expression families; gestures include
  nod, tilt, lean in, recoil, glare and flare.
- **Five voices** (crypt, velvet, rasp, choir, clerk).
- **A local library** in the browser (IndexedDB), seeded with Arch-Lich Malakor and part of the
  recorded cast. The rest of the thirteen join from the replay gallery in one click.

### 📺 Put it on air
- **The stage:** a full-screen haunted set for your stream, where the character answers chat in
  character, its face drives from the reply's emotion and gesture, and captions follow the voice.
- **The haunting does a job:** when the engine dies, the cellar bulb goes out.
- **A television set as the interface:** channels on a dial, the cast listed as a wall of sets, and
  the daemon's health shown in a root vault.

### 🚪 Take it anywhere
| | What it does |
|---|---|
| **Avatar packs** | Export any character (except Malakor) as one portable `.srpack`, and import packs others send you. |
| **`<sr-avatar>`** | One script tag puts a living character on any website: a 67 kB ES module with no framework, and moods, gestures and lip-sync from JavaScript. |
| **Stream overlay** | An OBS browser source that shows only the character on a transparent or green background, lip-syncs to your microphone, and switches moods on number keys. |
| **Studio** | Type a line, hear it in the character's voice, and record the talking character as a WebM video on a background colour you choose. |

## Pages

| Route | Key | Page |
|---|---|---|
| `/` | `2` | **On air**: the cellar set, where Malakor broadcasts on a walnut television |
| `/creator` | `3` | **Forge**: the creator (glass, layer stack, mood dial, Look, voice, library) |
| `/creator/new` | `N` | **Forge new**: the rite that turns a request into a character |
| `/characters` | `4` | **Characters**: tonight's listings, a wall of sets |
| `/daemon` | `6` | **Daemon**: the engine's health in the root vault |
| `/air` | `O` | **The stage**: full screen, for the stream |
| `/embed` | `E` | **Embed**: a live `<sr-avatar>` and its copy-paste snippet |
| `/overlay` | `B` | **Overlay**: the OBS source, and a setup card that builds its URL |
| `/studio` | `V` | **Studio**: a line in the character's voice, recorded to video |

Arrow keys step through the channels, `Ctrl+K` opens Go to, `T` switches theme (Halloween or
Baseline) and `Esc` returns to the set.

## Quickstart

Requires **Node 22.12 or later**.

```sh
npm install --global pnpm@11.3.0
pnpm install
pnpm dev
```

Open <http://localhost:5173>. No keys, GPU or login are needed. Everything runs on the
[replay plane](#replay-and-live).

| Command | What it does |
|---|---|
| `pnpm dev` | Build the cast packs and serve the web app |
| `pnpm build` | Production build: the app, `/embed/sr-avatar.js` and `/packs/` |
| `pnpm typecheck && pnpm lint && pnpm test` | The gates every change must pass |
| `pnpm test:e2e` | Live browser checks of packs, overlay, studio and embed ([Testing](#testing)) |
| `pnpm test:visual` | Screenshot guard for the landing |
| `pnpm vercel-build` | The Vercel Build Output, locally |

## Replay and live

Shadowrunner runs on one of two **planes**:

- **Replay** (the default) plays recorded forges, recorded show answers and recorded voices, and
  marks the screen with a **RECORDED** badge. A first visit works with no keys, so a judge sees
  the whole product.
- **Live** forges new characters (Gemini image, segmentation and TTS), answers chat with Claude,
  and speaks any line. It needs server-side keys ([Deploy](#deploy)), and secrets never reach the
  browser.

`pnpm dev` serves only the web app, so the client's `/api/health` check gets no answer and the
app stays on replay.

## Avatar packs

A character leaves Shadowrunner as an **avatar pack** (`.srpack`). It's one zip holding the rig,
every layer, region map and expression face, the saved look, the voice and a manifest with author
and licence.

```html
<script type="module" src="https://<your-deploy>/embed/sr-avatar.js"></script>
<sr-avatar src="https://<your-deploy>/packs/moth-widow.srpack" mood="smug"></sr-avatar>
```

- **Creator:** export from a Library card or from the channel actions; import with the Import
  button or by dropping a file on the Library.
- **Any app:** `@sr/pack` (`loadPack`, `decodePackImages`) reads a pack by URL or Blob, and
  `@sr/avatar/core` (`createAvatarPlayer`) renders it without React.
- **Sample packs:** the build publishes the recorded cast at `/packs/<slug>.srpack`, listed in
  `/packs/index.json`. They are generated, not committed, and served with CORS so other sites can
  load them.
- **Reference:** the full format, error codes and the `<sr-avatar>` API are in
  [docs/pack-format.md](docs/pack-format.md).

## Project layout

A pnpm TypeScript monorepo. Packages import each other by name, and none imports the app.

| Path | Package | Role |
|---|---|---|
| `apps/web` | `@sr/web` | React + Vite app: shell, channels, creator, stage, embed, overlay, studio |
| `api/` | | Vercel functions: forge, engine reply, voice, health, a daily cleanup cron |
| `packages/rig` | `@sr/rig` | Rig v1 and Look: types, validation, posing, moods (pure, no DOM) |
| `packages/avatar` | `@sr/avatar` | WebGL2 / Canvas 2D renderer, procedural driver, player, `<AvatarCanvas>` |
| `packages/forge` | `@sr/forge` | Forge pipeline steps: brief, portrait, parts, cut, fill, regions, expressions |
| `packages/engine` | `@sr/engine` | The co-host engine: scripted (replay) and Anthropic (live), voices, cast |
| `packages/pack` | `@sr/pack` | The `.srpack` format: write, read, load, decode |
| `packages/theme` | `@sr/theme` | Design tokens and the Halloween and Baseline themes |
| `assets/` | | Cast portraits, plates, and recorded replay forges and shows |
| `scripts/` | | Build output, cast packs, offline cast tools, gate fixtures |

## Testing

| Layer | Command | Covers |
|---|---|---|
| Unit and DOM | `pnpm test` | Vitest with happy-dom across every package, the app and the API |
| Static | `pnpm typecheck && pnpm lint` | Strict TS, ESLint with layering rules, Stylelint, token-only CSS, 400-line file cap |
| Visual | `pnpm test:visual` | Landing screenshots at a 2% pixel tolerance |
| End to end | `pnpm test:e2e` | Headless Chromium with a fake microphone against the production build |

The end-to-end suite checks transparency on **pixels**, not CSS. It drives the overlay
(microphone lip-sync, mood keys, a cutout over a transparent page) and the studio (a recorded WebM
with video, audio and a duration). It also exports and imports a pack in the creator, and loads
`<sr-avatar>` from another origin.

## Deploy

`vercel.json` hands the build to `pnpm vercel-build`. `pnpm build` writes the static app to
`apps/web/dist`, then `scripts/vercel-output.mjs` writes the Vercel Build Output to
`.vercel/output` (git-ignored):

- Each `api/**/*.ts` function is bundled with its `@sr/*` imports into one file (Node 22). Dynamic
  `[param]` files get a rewrite.
- The recorded replay files are published under `/replay/**`, the cast packs under `/packs/**`
  and the embed script under `/embed/**`. The packs and the embed script carry
  `Access-Control-Allow-Origin: *`.
- Routing serves static files and functions first, then the dynamic rewrites, then a 404 for any
  other `/api`, `/replay`, `/packs` or `/embed/<file>` path, then the single-page app. Every
  `api/cron/*` function is a daily cron.

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Needed for |
|---|---|
| `ENABLE_EXPERIMENTAL_COREPACK=1` | Installs with the pnpm pinned in `package.json` |
| `SR_PLANE=live` | Switches the deploy from replay to live |
| `GEMINI_API_KEY` | Forge images, segmentation and TTS |
| `ANTHROPIC_API_KEY` | The co-host's chat replies and character briefs |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis: forge jobs and quota |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob: forge images |
| `CRON_SECRET` | The daily Blob sweep |

A deploy with no variables runs on replay. Without KV and Blob, a live deploy refuses paid calls.
Every name is listed in [`.env.example`](.env.example).

</details>

## How it is built

Shadowrunner is built **spec-first with Kiro**. Everything Kiro reads lives in [`.kiro/`](.kiro):

- **`steering/`**: product, tech and structure rules, always in context.
- **`specs/`**: one spec per milestone, each with requirements, design and tasks: `m0-spine`,
  `rig-core`, `avatar-renderer`, `forge-pipeline`, `creator`, `voice-and-air`, `landing`,
  `costume`, `cast-forge`, `character-control`, `avatar-pack` and `avatar-reach`.
- **`agents/`**: `sr-builder` implements one task and cannot edit the spec it implements;
  `sr-reviewer` gives a read-only verdict per acceptance criterion.
- **`hooks/`**: gates on save and on stop, a contract-drift guard and a secret scan.
- **`settings/mcp.json`**: Playwright MCP for visual checks.

The write-up is in [docs/kiro-writeup.md](docs/kiro-writeup.md). Every task, with its builder,
outcome and corrections, is logged in [docs/kiro-log.md](docs/kiro-log.md).

## Provenance

The repo was created on 2026-10-31. Pre-existing art and writing (the Malakor character and rig)
are disclosed in [docs/provenance.md](docs/provenance.md). Malakor is never exported or published
as a pack.

## License

[MIT](LICENSE)
