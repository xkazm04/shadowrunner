# Design: costume

## Approach
Port, don't paste. Each prototype is a single HTML file with inline CSS and JS, raw colours, px
and a fake `<img>` rig. For each page, a builder reads the prototype, lists its states and
moments, and rebuilds them in the page's existing folder as React components and CSS Modules on
role tokens, driven by the app's real state (plane, health, daemon, show, forge client, look).
The prototype's DOM rig becomes `<AvatarCanvas>`; its layer stack, lights and parts become the
`Look` and rig data the app already has.

## Shared seams (task 1, before the lanes split)
- **Tokens.** Roles are added in `packages/theme/roles.json` and both theme files. Lanes may add
  roles too, each prefixed with its page (`slide-*`, `vault-*`, `wall-*`, `catacomb-*`, `rite-*`,
  `tag-*`); the orchestrator resolves the append conflicts at merge.
- **Fonts.** `@fontsource/barlow-condensed`, `@fontsource/caveat`, `@fontsource/im-fell-english`
  bound to new roles `font-condensed`, `font-hand`, `font-old`.
- **Plates.** `assets/plates/root-vault.webp` and `catacomb.webp` (committed with this spec).
- **Channel strip.** `apps/web/src/app/ChannelStrip.tsx` (+ module css, test): the film strip from
  the prototype's "On other pages" card, derived from `PAGES` / `channelPages`, with props
  `current`, `daemonLost`, `variant: "frame" | "stage"`. `ChannelFrame` renders it in place of
  "Back to the set" (Esc stays the shell's key). The landing renders its own big slide tray and
  does not use the strip.
- **Route.** `PAGES` gains `{ id: "forge-new", title: "Forge new", path: "/creator/new",
  subtitle: "a new character", hotkey: "N", status: "live" }` with no channel (off the dial,
  like `air`). Keymap and router tests updated.
- **Look-at.** `packages/avatar`: `lookAtOffset(point, limits)` pure function plus an optional
  `lookAt` prop on `<AvatarCanvas>` and a `lookAt` field on `DriverInputs`. Property test per
  Requirement 9.

## Lanes (tasks 2-6, in parallel worktrees after task 1)
| Lane | Owns (write scope) | Reads |
|---|---|---|
| landing | `apps/web/src/landing/**`, `apps/web/e2e/**` | daemon state, chat script, ChannelStrip |
| creator | `apps/web/src/creator/**` (incl. a new `creator/rite/` for `/creator/new`) | forge client, replay jobs, `@sr/avatar` |
| characters | `apps/web/src/channels/Listings*` | listings data, cast thumbs |
| daemon+sealed | `apps/web/src/channels/{Daemon,Sealed,Tube}*` | `landing/daemon.ts`, health |
| air | `apps/web/src/air/**` | show, rig, ChannelStrip (`variant="stage"`) |

Every lane may append prefixed roles to the theme (above) and may wire its page in
`apps/web/src/app/Shell.tsx` / page registry only where task 1 left a marked hook. Anything else
outside the scope: stop and report.

## Per-page notes
- **Landing.** The torch is a CSS radial mask driven by a pointer/focus position in a ref (no
  React render per mousemove). The slide tray is six buttons; a pulled slide projects a sepia
  still: CH 3 `replay/thumbs/lantern-warden`, CH 4 a cast still, CH 6 a bulb, CH 9 a sealed eye,
  stage the CRT plate. Keep `daemon.ts` choreography (online, folding, dark, relighting). Delete
  Gourds, Spiral, Eye, Room pumpkin art and their tests; keep pure modules and their properties
  (`chatScript`, `daemon`, `superellipse` if still used).
- **Creator.** The pinned labels are positioned from rig layer anchors (`layers.json` bboxes via
  the rig), so they track the face. Swatch rings write `Look.palette`; layer toggles write
  `Look.hidden`; the knob writes `Look.emotion`. Layer hover highlight is a CSS outline over the
  layer's bbox, not a renderer change. `/creator/new` reuses `forgeClient` and `replayJobs`; the
  slot list fills from the job's layer list as statuses arrive.
- **Characters.** Cabinets are CSS (gradients, borders, pseudo-elements) on role tokens; the
  live hour uses `<AvatarCanvas>` in its tube, others the cast stills.
- **Daemon.** The relight is a canvas mask over the plate driven by the bulb's swing angle
  (requestAnimationFrame, paused under reduced motion). Roots in the cut state are an SVG path set
  whose growth is a pure function of dead-air seconds (unit-tested).
- **Sealed.** Hold-to-power uses pointer and Space; the reflection strength is a pure function of
  the switch-off count (unit-tested).
- **Air.** Remove `fog.ts`, its tests and CSS. A pure `candleLevels(rate, now, posts)` replaces the
  fog binding (property test: bounded 0..1, rises with rate, a post flares its candle). The
  centred caption layout keeps word-by-word reveal without words jumping lines.

## Verification
Each lane: gates green, Playwright screenshots of its page at 1440x900 and 1280x720 compared by
eye with the prototype thumbnail in `assets/_incoming/costume/`, and both daemon/line states.
Integration (task 7): merge, gates, re-baseline `landing.visual.spec.ts`, contrast checks, update
`docs/kiro-log.md` and `docs/kiro-writeup.md`.
