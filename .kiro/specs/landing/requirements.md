# Requirements: landing

## Introduction
The owner chose **The Harvest Floor** on 2026-10-31, after four contest rounds:
- `shadowrunner-cellar-dread`: Dead Air won.
- Round 2: Root Cellar won.
- Round 4: `shadowrunner-root-cellar-r4`, variant A/1, won.

The landing is the broadcast itself. Arch-Lich Malakor is live on a walnut television that stands
on the floor of a photoreal root cellar. Rotting gourds are the remote, and a paper chat strip is
tacked under a rafter. Only you are watching.

The reference prototype lives in `assets/_incoming/landing-winner/`. Its files are:
- `index.html` and `NOTES.md`;
- `img/` with the composited stills;
- `stills-source/` with the original stills;
- `screenshots/` with every channel state at 1600x900 and the landing at 390x844.

It opens from disk. The port is a rewrite into React and CSS Modules on role tokens, not a copy.

## Requirement 1: Record the verdict
**User story:** As a builder, I want the chosen variant named in the spec, so that I port the right thing.

#### Acceptance criteria
1. Task 0 SHALL record the owner's verdict, the variant id and its path, and the owner's notes verbatim (done by the orchestrator).
2. The reference prototype SHALL stay in `assets/_incoming/landing-winner/` and SHALL never be imported by the app.

## Requirement 2: The header carries the broadcast state
**User story:** As a visitor, I want to see at a glance whether the show is live, so that the status reads as part of the world.

#### Acceptance criteria
1. The header row SHALL show, left to right:
   - the wordmark;
   - an ON AIR lamp;
   - the viewers count;
   - the current channel (number and name);
   - a "Live since 03:00 · up hh:mm:ss" clock.
   The daemon pill (`Daemon online` + key `D`) SHALL sit at the right.
2. The ON AIR lamp, the clock and the daemon pill SHALL be bound to the real plane and health state (`usePlane()`, `/api/health`), not to a decorative toggle.
3. WHEN the daemon is lost THEN the lamp SHALL read OFF AIR, the clock SHALL become "Dead air for hh:mm:ss", and the pill SHALL read "DAEMON LOST · re-seat".
4. The page SHALL NOT have the middle column of earlier rounds (headline, description, CTA buttons). The channels are the calls to action.
5. On the replay plane, a "sample state" toggle for the daemon (key `D`) MAY remain, and it SHALL be labelled as a sample.

## Requirement 3: The set is the hero
**User story:** As a visitor, I want the character to be live inside a real television, so that the product is the first thing I see.

#### Acceptance criteria
1. The frontal CRT plate (`crt-frontal`) SHALL stand centred on the cellar floor.
2. The live picture SHALL be `<AvatarCanvas>` (spec `avatar-renderer`) clipped to the glass's superellipse `|x/253|^3 + |y/204|^3 = 1`, centred at (597, 427) in the plate's 1200x896 pixel space. The clip SHALL scale with the plate, with no visible gap and no spill at the rim at any supported size.
3. The plate's own glare, a rim shadow and the scanline/phosphor grade SHALL sit above the picture inside the same mask. A lower third ("LIVE · <character>" and one line of story) SHALL sit inside the glass.
4. Malakor SHALL read as dread, not cartoon: a cold phosphor grade from the theme, never a flat green tint.
5. WHEN the user has put their own character on air (spec `voice-and-air`) THEN the set SHALL show that character instead of Malakor.

## Requirement 4: The room
**User story:** As a visitor, I want to feel I have walked into a basement I should not be in, within three seconds.

#### Acceptance criteria
1. The wide root-cellar plate SHALL fill the frame behind the set.
2. A lit spiral pumpkin SHALL sit in the left foreground and throw light dots onto the wall. A gourd pile with one carved eye SHALL sit on the right.
3. Stills SHALL be composited into the dark with masks, radial falloff and blend modes, with no visible rectangle edges. No photo SHALL sit behind body text.
4. The eye's pupil SHALL follow the pointer with easing, and with no lag once the daemon is lost.
5. Dust, flicker and ember motion SHALL be light on top of the photographs, never drawn props.

## Requirement 5: The gourds are the remote
**User story:** As a visitor, I want navigation that belongs in the room, so that wayfinding and atmosphere are one layer.

#### Acceptance criteria
1. The channel row SHALL show five gourds cut from `root-pile`, each with its channel number carved through and a text label beneath at 14 px or larger:
   - 2 On air;
   - 3 Forge;
   - 4 Characters;
   - 6 Daemon;
   - 9 Sealed.
2. The current channel's gourd SHALL burn and the others SHALL hold an ember. Changing channel SHALL move the light along the row.
3. Keys `2 3 4 6 9` SHALL select channels, `←`/`→` SHALL turn the dial, `Esc` SHALL go back to the set, and `D` SHALL toggle the daemon (replay sample only). All of these SHALL derive from the page manifest (m0-spine) as the single keymap. A legend box SHALL show them.
4. Hovering or focusing a gourd SHALL write that channel's name across the glass.
5. Gourds SHALL be real buttons with accessible names and a visible focus ring. The carved numbers SHALL meet AA contrast against the gourd (fix the reference's weak legibility).

## Requirement 6: Live chat strip
**User story:** As a visitor, I want to see the co-host answering a chat, so that I understand what it does.

#### Acceptance criteria
1. The chat SHALL be a paper strip tacked under the rafter on the right. Real HTML text of 16 px or larger SHALL sit on opaque paper, with Malakor's lines in the paper's signal ink.
2. The chat SHALL be scripted on replay and SHALL type in line by line. On live, it SHALL come from the engine (spec `voice-and-air`).
3. The newest lines SHALL stay visible, and older lines SHALL fade under a top mask. Text SHALL never run under the header (fix of the reference defect).

## Requirement 7: Daemon lost
**User story:** As a visitor, I want the haunting to do a job, so that a broken engine is impossible to miss and still in-world.

#### Acceptance criteria
1. WHEN the engine health turns unreachable (or the sample toggle is pressed on replay) THEN the picture SHALL fold to a dot and show "NO CARRIER · Press D to re-seat the daemon".
2. The spiral pumpkin and each gourd SHALL then go out one by one. Their carved numbers SHALL stay readable as cold cuts, and the gourd buttons SHALL stay usable.
3. Only the eye SHALL keep burning, with the caption "IT IS STILL LOOKING".
4. WHEN health returns THEN the room SHALL relight in a sweep.

## Requirement 8: Channels behind the set
**User story:** As a visitor, I want each channel to open in the same world, so that the app and the landing are one place.

#### Acceptance criteria
1. Each channel other than 2 SHALL open a page with:
   - a "Back to the set · Esc" control;
   - a breadcrumb in the form `SHADOWRUNNER ▸ CH n · Name · subtitle`.
2. Channel 3 SHALL be the creator, "behind the back panel" (spec `creator`). Channel 4 SHALL be "Cellar Listings", a parchment programme page. Channel 6 SHALL be the daemon status. Channel 9 SHALL be the sealed door.
3. The screenshots in `assets/_incoming/landing-winner/screenshots/ch-*.png` are the look to follow.

## Requirement 9: Scale, motion and access
**User story:** As any visitor, I want the scene to hold on my screen, and to stay calm when I ask for that.

#### Acceptance criteria
1. The scene SHALL be one 1600x900 world that scales as a unit from 1280x800 to 2560x1440. Below an aspect ratio of 0.78, it SHALL switch to a 420x910 portrait world stacked as header, set, gourds, then chat. There SHALL be no clipping and no overlap at 390x844.
2. WHEN `prefers-reduced-motion: reduce` THEN the scene SHALL render static, with no flicker, dust, typing or camera moves. The daemon-lost state SHALL change instantly.
3. Any intro SHALL be skippable by any key or click and SHALL hand over control within 4 s. It SHALL never pull the visitor back if they have already navigated.
4. Lighthouse accessibility SHALL score 90 or more on the deployed landing. Working text SHALL be 14 px equivalent or larger, with AA contrast.
5. First load SHALL be 2 MB or less. LCP SHALL be the cellar plate, not a canvas. Effects SHALL load lazily.
6. All imagery SHALL be labelled "Stylised photos · simulated chat" (or "live chat" on the live plane).

## Requirement 10: Guards
**User story:** As the owner, I want the first frame protected, so that a token change cannot silently ruin it.

#### Acceptance criteria
1. A Playwright screenshot test SHALL capture the landing on the replay plane with reduced motion:
   - at 1600x900, in both `halloween` and `baseline`;
   - at 390x844, in `halloween`;
   - in the daemon-lost state at 1600x900.
   It SHALL compare against committed baselines with a 2% pixel tolerance.
2. The test SHALL run in `pnpm test:visual`, not in the default `pnpm test`.
