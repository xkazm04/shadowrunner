# Design: landing - The Harvest Floor

## Reference
`assets/_incoming/landing-winner/` is the prototype. Open `index.html` from disk; it loads the
rig from `assets/_incoming/malakor-rig/`. Read `NOTES.md` first. The screenshots are the
acceptance look:
- `R4-1-1600x900-load.png` and `R4-1-390x844-load.png`: the set at desktop and phone width;
- `ch-forge`, `ch-characters`, `ch-daemon`, `ch-daemon-lost`, `ch-sealed`: the other channels.

Port the look in the form the prototype expresses it. Gradients, masks and pseudo-elements stay
as CSS; do not approximate them with the nearest token. Literal colours become role tokens.

## Files
```
apps/web/src/landing/LandingPage.tsx      composition root; reads usePlane(), useHealth(), useChannel()
apps/web/src/landing/World.tsx            1600x900 world (420x910 portrait below 0.78 aspect), scale-to-fit
apps/web/src/landing/StatusBar.tsx        wordmark, ON AIR lamp, viewers, channel, clock, daemon pill
apps/web/src/landing/Room.tsx             cellar plate, rafters, light throw, vignette (static layers)
apps/web/src/landing/Set.tsx              CRT plate + Glass (mask) + knob
apps/web/src/landing/Glass.tsx            superellipse clip, <AvatarCanvas>, grade, glare, lower third, hover caption
apps/web/src/landing/Gourds.tsx           channel row (buttons), burn/ember state, legend
apps/web/src/landing/ChatStrip.tsx        paper strip, typed lines, top fade mask
apps/web/src/landing/Eye.tsx              eye gourd + pupil tracking
apps/web/src/landing/Spiral.tsx           spiral pumpkin + light dots on the wall
apps/web/src/landing/daemon.ts            pure state table: online -> folding -> dark -> relighting
apps/web/src/landing/superellipse.ts      pure: path(cx, cy, a, b, n, steps) -> SVG path / clip-path polygon
apps/web/src/landing/chatScript.ts        replay chat lines (from the reference)
apps/web/src/landing/fx/*.ts              dust, flicker, typing (lazy chunk, behind data-motion)
apps/web/src/landing/*.module.css         role tokens only
apps/web/src/channels/ChannelFrame.tsx    "Back to the set · Esc" + breadcrumb, shared by CH 3/4/6/9
apps/web/src/channels/Listings.tsx        CH 4 Cellar Listings (parchment)
apps/web/src/channels/Daemon.tsx          CH 6 daemon status (health, plane, quota)
assets/plates/                            WebP from assets/_incoming/landing-winner/img (provenance recorded)
apps/web/e2e/landing.visual.spec.ts       pnpm test:visual
```

## Channels and the manifest (amends m0-spine)
| channel | page id | path | key | status |
|---|---|---|---|---|
| 2 On air | `landing` | `/` | `2` | live |
| 3 Forge | `creator` | `/creator` | `3` | live |
| 4 Characters | `characters` | `/characters` | `4` | live |
| 6 Daemon | `daemon` | `/daemon` | `6` | live |
| 9 Sealed | `sealed` | `/sealed` | `9` | sealed |
| - | `air` | `/air` | `O` | live (full-screen stage / OBS source, opened from the set) |

`PageDef` gains `channel?: number` and `subtitle?: string`.
- Gourds render manifest entries that have a `channel`, in ascending order.
- `←`/`→` move to the previous or next channel. `Esc` returns to `/`.
- `D` is a global key handled by the shell. It works only on the replay plane.

## Glass geometry
- Plate space is 1200x896, with the centre at (597, 427), half-axes a=253 and b=204, and exponent n=3.
- `superellipse.ts` produces the clip in percentages of the plate box, so it scales with CSS.
- One clip is shared by four layers: the picture, the grade, the glare and the lower third.
- Property test (fast-check): every generated point satisfies |x/a|^n + |y/b|^n ≈ 1 within 1e-6, and the polygon stays inside the plate box.

## Tokens (new roles, added to roles.json and both themes)
The halloween values come from the reference `:root`:

| role | halloween value |
|---|---|
| `text-strong` | #efe6d0 |
| `text` | #c9bc9c |
| `text-muted` | #9c8f74 |
| `signal-onair` | #ff4a33 |
| `signal-warn` | #ff5b45 |
| `signal-ok` | #8fe3b0 |
| `accent` | #f0a860 |
| `phosphor` | #e8f0ff |
| `phosphor-2` | #b9cdf2 |
| `phosphor-spill` | rgb(150,180,255) |
| `ember` | #ffb347 |
| `paper` | sampled from `img/paper.jpg` |
| `paper-ink` | from the reference chat rules |
| `paper-ink-signal` | from the reference chat rules |

Fonts: `font-display`, `font-body` and `font-type`. The reference relies on Bahnschrift and
Segoe UI, which exist only on Windows. The port ships self-hosted OFL fonts through `@fontsource`,
so every OS renders the same:
- **Barlow Semi Condensed** (display);
- **Inter** (body);
- **Courier Prime** (typewriter).

The baseline theme binds every new role.

## Daemon state machine (`daemon.ts`, a table)
| state | entered by | wall clock | picture | gourds | eye | lamp |
|---|---|---|---|---|---|---|
| online | health ok | Live since / up | live | current burns, others ember | eased | ON AIR |
| folding | health lost | Dead air for | fold to dot (600 ms) | - | - | OFF AIR |
| dark | after fold | Dead air for | NO CARRIER | go out one by one (right to left, 140 ms apart) | burns, no lag, "IT IS STILL LOOKING" | OFF AIR |
| relighting | health ok | Live since | live | sweep relight (left to right) | eased | ON AIR |

Reduced motion collapses the timed transitions to instant switches. Tests drive the table with fake timers.

## Fixes over the reference (known defects)
- The top of the chat ran under the header. ChatStrip clips to its own box with a top fade mask.
- Carved numbers were hard to read on mottled gourds. They get an engraved highlight and shadow, a darkened
  cut behind them, and an AA check in the visual test.
- The set's base is cut off by the edge of its photo. Fade it into floor shadow, as the reference does.

## Testing strategy
- Unit tests:
  - superellipse property test;
  - daemon table transitions (fast-check over random health sequences: ends consistent, never skips `folding`);
  - keymap derived from the manifest (keys unique, channels ascending).
- Component tests:
  - status bar reflects health;
  - gourd buttons have names and focus;
  - chat never renders outside its box;
  - reduced motion renders no animated nodes.
- Visual tests (`pnpm test:visual`):
  - 1600x900 in both themes;
  - 390x844 in halloween;
  - daemon-lost at 1600x900.
  All use reduced motion on the replay plane, with a 2% tolerance and baselines committed.
- Checked manually on the deployed URL, with results recorded in `docs/kiro-log.md`:
  - Lighthouse accessibility of 90 or more;
  - first-load weight of 2 MB or less.
