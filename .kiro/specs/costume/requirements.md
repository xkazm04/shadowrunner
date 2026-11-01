# Requirements: costume

## Introduction
Shadowrunner is entered in the Kiroween 2026 Costume Contest, judged on visual creativity and
execution. On 2026-11-01 the owner ran two triage rounds: three HTML prototypes per page per round,
one winner per page, with notes carried into the next round. This spec ports the winners into the
app. It amends `landing` (CH 2, the channel frame), `creator` (CH 3), `voice-and-air` (/air) and
the CH 4, 6 and 9 channels; earlier specs stay the record of what they built.

The reference prototypes live in `assets/_incoming/costume/` and open from disk. The port is a
rewrite into React and CSS Modules on role tokens, not a copy. The prototypes fake the face with
stacked `<img>` layers; the app keeps the real renderer (`@sr/avatar` `<AvatarCanvas>`).

| Page | Winner | Reference |
|---|---|---|
| CH 2 On air (`/`) | R2 C "The Lantern Slides" (torch cellar, magic-lantern slide menu) | `r2/landing-c.html` |
| CH 3 Forge (`/creator`) | R1 B "Anatomy Under Glass" | `r1/creator-b.html` |
| Forge new (`/creator/new`, new) | R2 A "The Rite in Four Marks" | `r2/creator-a.html` |
| CH 4 Characters | R1 C "The Wall of Sets" (owner kept it over every R2 variant) | `r1/characters-c.html` |
| CH 6 Daemon | R2 C "The Root Vault" | `r2/daemon-c.html` |
| CH 9 Sealed | R1 C "Lights Out, Nine" | `r1/sealed-c.html` |
| The stage (`/air`) | R2 B "Candles of the Catacomb" | `r2/air-b.html` |

## Requirement 1: Record the verdict
**User story:** As a builder, I want the chosen variants named, so that I port the right thing.
#### Acceptance criteria
1. Task 0 SHALL record the owner's picks and notes verbatim (done by the orchestrator).
2. The prototypes SHALL stay in `assets/_incoming/costume/` and SHALL never be imported by the app.

## Requirement 2: One channel strip on every page
**User story:** As a visitor, I want to switch channels from any page, so that I never have to go back to the set first.
#### Acceptance criteria
1. Every page except `/air` SHALL show the compact film-strip switcher from `r2/landing-c.html` ("On other pages" card): one frame per channel 2, 3, 4, 6, 9 and the stage, the current page's frame lit, derived from `PAGES`.
2. On `/air` the strip SHALL be hidden for stream capture and SHALL open on hover of the top edge, on focus, or on the `C` key; `Esc` closes it.
3. When the daemon is lost, the strip's lamp SHALL go cold (frames stay readable and operable).
4. The strip SHALL be keyboard operable with a visible focus and an accessible name per frame.

## Requirement 3: On air is a lantern-lit cellar
**User story:** As a first-time visitor, I want the landing to sell "forge an AI co-host" in seconds.
#### Acceptance criteria
1. The landing SHALL port `r2/landing-c.html`: dark cellar, pointer torch, Malakor as the live rig projected out of the dark, hanging ON AIR lightbox, chalk chat, and the magic-lantern slide tray as the channel menu.
2. Pulling a slide (hover or focus) SHALL project that channel's image onto the wall at lower brightness than the face; channel 2 does not project.
3. The torch SHALL follow the pointer and keyboard focus; Malakor's gaze SHALL follow it (Requirement 9).
4. Daemon lost SHALL cool the lantern (slides dark, no projection), fold the face, and show the dead-air clock, as the current landing does.
5. The gourd menu and every rotting-pumpkin element SHALL be removed from the landing.

## Requirement 4: The Forge and its new-character page
**User story:** As a streamer, I want to dress my character on the face itself and to forge a new one on its own page.
#### Acceptance criteria
1. `/creator` SHALL port `r1/creator-b.html`: no tabs; labels pinned to the face open swatch rings for eye, glow, rim and mouth light; the layer stack is a live index beside the face with per-layer visibility; a mood knob (10 emotions, arrow keys), gestures and voices; the cast strip.
2. Every control SHALL drive the existing look/state (`Look` palette, hidden layers, emotion, gesture, voice); nothing is faked in the view.
3. A new page `/creator/new` ("Forge new") SHALL port `r2/creator-a.html`: four marks Describe, Bind, Forge, Wake; empty layer slots filling as the forge job runs; the replay job plays with its recorded holds; the likeness refusal is shown with the API's `refused_likeness` copy; the run ends by handing the new face to `/creator`.
4. The forge flow SHALL use the existing forge client (`forgeClient`, replay jobs); on the live plane it runs a real job.

## Requirement 5: Characters is a wall of sets
#### Acceptance criteria
1. CH 4 SHALL port `r1/characters-c.html`: the junk-shop wall of stacked televisions, one face per hour, sets powering on in schedule order, hover or focus warming a tube and casting the character's colour, a pinned clipping with the selected listing and its Forge and Watch actions; 09:00 static; CH 9 taped over.
2. Listing copy SHALL stay sourced from the existing listings data.

## Requirement 6: Daemon is the root vault
#### Acceptance criteria
1. CH 6 SHALL port `r2/daemon-c.html`: the root-vault plate relit from the swinging bulb, the giant state word on the floor, readings and events, the chain and `D` to cut and restore.
2. Every reading SHALL come from the real health and daemon state (`landing/daemon.ts`, `/api/health`).
3. Daemon lost SHALL leave only moonlight, grow the roots with the dead-air counter, and say so in text.

## Requirement 7: Sealed is lights out
#### Acceptance criteria
1. CH 9 SHALL port `r1/sealed-c.html`: dark cellar, torch pointer, a paper tag that states "CH 9 · Sealed · not built yet" and the lore line, the hold-to-power tube, and the reflection that grows each time the set is switched off.
2. The page SHALL offer no fake feature and SHALL always show how to get back.

## Requirement 8: The stage is the catacomb
#### Acceptance criteria
1. `/air` SHALL port `r2/air-b.html`: the catacomb plate with its vanishing point behind the face, the tunnel backlight swelling while he speaks, the ON AIR box hung dead centre, centred captions, eight wall candles.
2. The fog effect SHALL be removed (`fog.ts` and its bindings); chat velocity SHALL drive the candles instead (flame height, glow, floor reflection; a candle per chatter flares on their message).
3. LINE DEAD SHALL burn the candles to embers and put the tunnel light out; the bulb retries every 5 s as today.
4. The show loop, captions, chat, VOICE, RECORDED and the haunt toggle SHALL keep working.

## Requirement 9: The face follows a point
#### Acceptance criteria
1. `<AvatarCanvas>` SHALL accept an optional `lookAt` point in normalised view space; when present it biases eye and head offsets toward it within the rig's existing limits; when absent, behaviour is unchanged.
2. The mapping SHALL be a pure function with a property test (bounded output, monotone in each axis, identity at the centre).

## Requirement 10: Craft and accessibility rules hold
#### Acceptance criteria
1. CSS Modules SHALL use role tokens only; new colours enter as roles in `roles.json` and both themes.
2. New fonts (Barlow Condensed, Caveat, IM Fell English) SHALL be self-hosted through `@fontsource`.
3. Working text SHALL be at least 14 px and meet AA; every animation SHALL have a reduced-motion twin.
4. The face SHALL stay the brightest, sharpest element wherever a character is shown.
5. Gates: `pnpm typecheck && pnpm lint && pnpm test` green; the landing visual test re-baselined.
