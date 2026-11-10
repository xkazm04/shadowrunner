# Requirements: perfection-pass

## Introduction
Ten improvements chosen by the owner on 2026-11-09 from a scouted list (spark `perfection-pass`):
four to key functionality (F1-F4), three to visual quality (V1-V3), three to performance (P1-P3).
Each one closes a gap the scouts read in the code. Everything must work on the replay plane with
no keys; live-plane parts (marked LIVE) are covered by tests with fakes because the build machine
has no model keys. Owner decision: every package is built by a Claude Opus builder under this
spec (the owner asked for Opus builders by name); the Director reviews, gates and logs.

Global rules for every requirement: the three gates stay green; every animation has a
reduced-motion twin; tokens only in CSS; 400-line file cap; no behaviour change for a rig or a
caller that does not opt in unless the requirement says the default changes; `still` renders and
the landing visual baseline (2 % tolerance) keep passing, or the builder reports the diff.

## Requirement 1: Renderer runtime (P1)
1. An avatar (AvatarCanvas and createAvatarPlayer's own loop) SHALL stop stepping and drawing
   while the document is hidden or its canvas is fully outside the viewport, and resume without a
   time jump. Option `pauseOffscreen` (default true) turns this off.
2. The drawing buffer SHALL use `min(devicePixelRatio, 2)`.
3. The glow pass SHALL be skipped for a frame with no glow source; output for rigs with glow is
   unchanged.
4. After `webglcontextrestored` the WebGL renderer SHALL be rebuilt (programs, textures, targets)
   and used again; the Canvas 2D fallback is kept only while the context is lost or WebGL2 is
   unavailable.
5. Steady-state per-frame allocation in `poseLayers` and the GL layer draw path SHALL be reduced
   (reused buffers, typed-array uniforms), with before/after figures from `apps/web/bench/avatar.ts`
   in the report. A change that does not measure better is withdrawn.

## Requirement 2: Secondary motion (V1)
1. Layers that float or follow (hair, crowns, ornaments, tags) SHALL lag and overshoot the head's
   yaw/pitch, gestures and acts through a damped spring advanced on the driver clock.
2. It SHALL be deterministic for a seed and a step sequence, stable for any `dt` up to
   `MAX_STEP_S`, and at rest SHALL equal today's pose (zero offset when the head is still).
3. Reduced motion and `still`: no spring offset.
4. Per-rig control: an optional rig/look field sets strength (0 disables); the default applies to
   every character without re-forging. Amplitude is bounded relative to the layer's own size, so
   no layer detaches from its attachment on any of the thirteen cast rigs (checked on all).

## Requirement 3: Depth turn and lighting (V2)
1. Head yaw/pitch SHALL deform head-attached layers (a mesh warp giving foreshortening and
   curvature), not only pan them, in the WebGL renderer; at yaw = pitch = 0 the output is
   pixel-identical to today.
2. The rim light SHALL become directional: a pseudo-normal from the alpha/luminance gradient lit
   from the Look's palette lights, with the head turn moving the light across the face.
3. Both SHALL be bounded by a per-rig strength with a conservative default, and SHALL be checked
   on every cast rig with an overlay/contact sheet the builder looks at (repo law: per-character
   art geometry). Mouth warp, iris sockets and closed lids stay registered to the deformed head.
4. Canvas 2D fallback keeps today's rigid pan (documented).

## Requirement 4: Real lip-sync (F1)
1. `@sr/avatar` SHALL provide an analyser that turns a decoded voice clip (and, when given, its
   text) into a timed mouth-shape track over the existing eight `ShapeWeights`, React-free.
2. `AvatarCanvas` SHALL accept the track (or a per-frame shape source) and drive
   `mouth` in the frame body; the player keeps `setMouthShapes`. The lab's scheduler logic is
   reused by moving it into `@sr/avatar`, not copied (ESLint layering: packages never import apps).
3. The stage (`/air`), the creator's "speak a line" and the studio SHALL use it for rigs whose
   `mouthMode` is "drawn" or "warp"; other rigs keep the loudness jaw. A clip that cannot be
   analysed falls back to loudness. Recorded replay voices work with no network call beyond the
   clip itself.
4. The stage SHALL analyse audio once (one analyser tap, one AudioContext closed on unmount).
5. Reduced motion: one soft speaking shape, as the lab's twin.

## Requirement 5: Never dead air (V3)
1. While a reply or its voice is pending, the stage SHALL show a thinking state on the face
   (listening pose, eyes to chat) and in the caption bar, and a visitor's message SHALL carry a
   queued mark until it is picked.
2. The reply's emotion SHALL show when the reply arrives, not when audio starts.
3. A film-grain layer SHALL be added to the stage (own component and CSS module, token-driven,
   static under reduced motion).
4. LIVE: while a line plays, the next beat's reply and voice SHALL be prefetched (one beat ahead,
   cancelled if a visitor message pre-empts it; quota charged once). The persona bible SHALL be
   sent with prompt caching. Tested with fake engine and voice clients.
5. A cue-word act that meets its cooldown SHALL be rescheduled or dropped by a stated rule, with
   a test (verify the suspected loss at `useActCue.ts:35-36` first; if it is not a bug, say so).

## Requirement 6: Studio director (F4)
1. The studio SHALL let the user set mood and gesture per line; a recorded replay line uses its
   recorded emotion by default.
2. A script of several lines SHALL record as one video.
3. Aspect presets (1:1, 9:16, 16:9) SHALL set the recorded size independent of the on-screen size.
4. A transparent background SHALL be offered only if the recorded file is verified to carry
   alpha on pixels in the e2e browser; otherwise the option is absent and the report says why.

## Requirement 7: Creator history (F2)
1. Look edits SHALL be undoable and redoable (buttons, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), a slider
   drag being one step; history is per character for the session.
2. A press-and-hold Compare SHALL show the look as it was when the character was opened.
3. A character SHALL be renamable and duplicable as a variant (new id, copied assets and look).
4. A pending look or voice save SHALL be flushed on character switch, unmount and `pagehide`.

## Requirement 8: Replay honours the request (F3)
1. On the replay plane a new description SHALL be matched to the nearest recorded cast character
   by a deterministic score over the brief fields, and the brief card SHALL say plainly that this
   is a recording chosen for the request, naming what matched.
2. The forge replay that follows SHALL be that character's recorded job. Client and server
   matchers SHALL agree (one shared pure function).

## Requirement 9: Editor cost (P3b)
1. Library thumbnails SHALL be stored on the record, honour the saved look, and be rebuilt only
   when the record or look changes.
2. A slider drag SHALL re-render only the control being dragged and the cards that read the
   changed slice; verified with a render-count test.

## Requirement 10: Load diet (P2)
1. A fresh production build SHALL be measured before and after (per-type totals, entry JS/CSS,
   first-load bytes of `/`).
2. PNG that the app serves SHALL be WebP where a lossless/visually identical WebP exists or can be
   made; sources the forge or pack scripts need stay.
3. Recorded voices SHALL ship compressed (a format Chrome, Firefox and Safari decode), the replay
   voice route pointing at them.
4. Static responses SHALL carry Cache-Control: immutable for hashed assets, revalidated for
   `/packs`, `/replay`, `/embed`.
5. The landing's LCP image SHALL be preloaded; woff fallbacks dropped; the 721 kB cast chunk split
   so `/characters` loads only what it shows.
6. Landing task 10.2 (first load <= 2 MB, Lighthouse accessibility >= 90) SHALL be measured and
   reported.

## Requirement 11: Set paint cost (P3a)
1. Stage-light variables SHALL be written on the layers that read them, not the stage root.
2. The landing's flicker SHALL not re-rasterise a full-world gradient at 30 Hz (animate opacity
   or transform of a composited layer instead), looking the same within the visual tolerance.
3. Stage and landing rAF loops SHALL stop while the document is hidden.
4. Before/after figures (a recorded performance trace or frame-time capture) in the report; a
   change that does not measure better is withdrawn.

## Follow-up (owner decisions, 2026-11-10)
The owner kept the V1/V2 defaults as merged and the reply joining the chat at line start, and
asked for the four items below.

## Requirement 12: Served art as lossy WebP (closes 10.2)
1. Every character PNG the app serves SHALL also exist as a WebP encoded at quality 90 with
   lossless alpha, and the app (creator loaders, replay API, landing, cast pages) SHALL request
   the WebP. The PNGs stay as the sources the pack builder and forge scripts read.
2. Each character SHALL pass its art geometry check on the WebP: alpha identical to the PNG,
   and colour within a stated per-channel tolerance at the measured mouth, sockets and seams.
3. Malakor's pre-existing art SHALL NOT be re-encoded (house art stays byte-identical).
4. A fresh build SHALL be measured before and after (PNG/WebP totals, deploy static, first
   load of `/`), and a provenance row SHALL describe the derived files.

## Requirement 13: Briefs for the unmatched cast
1. Moth Widow, Sister Vesper, Understudy, Lantern Warden and Announcer of Dead Air SHALL each
   get a brief in the same schema as the eight recorded ones, written from that character's
   recorded art and parts, so `matchCastBrief` can choose them.
2. Each SHALL be marked as authored after the recording (a field in the brief and a provenance
   row), never presented as the recorded request.
3. Malakor SHALL get no brief and SHALL never be matched.
4. A request naming each character's signature traits SHALL match that character (test).

## Requirement 14: Cleanup
1. `--heat` SHALL be written on the elements that read it, not the stage root.
2. The lip-sync fitting scripts SHALL be committed (sources only, no corpora over 1 MB) and
   runnable from a documented command.
3. The lab's lip arms SHALL draw on the voice's clock (lag under one frame).
4. The e2e port SHALL come from an environment variable with 4320 as the default.

## Requirement 15: Announcer hood gap
1. Announcer of Dead Air SHALL be rendered at the pre-pass commit `e6ba255` and at `main` in
   the studio cutout and on the stage, and the report SHALL say which commit introduced the gap.
2. If the pass introduced it, it SHALL be fixed through the Announcer's own rig or look settings
   (or a general rule if the cause is general), with the before/after frames.

## Requirement 16: The forge cut keeps every piece (owner decision, 2026-11-10)
Task 15 found that the cut leaves foreground pieces (the Announcer's chest grille and collar, the
Understudy's chest, the Lantern Warden's collar) only in the backdrop, which the studio cutout and
the stage hide, so a gap shows through.
1. The forge's cut SHALL assign every foreground pixel of the portrait to some character layer, so
   that with the backdrop hidden the rest pose covers the character's whole silhouette.
2. A forge check SHALL fail when a portrait's foreground is not covered by the layers at rest, and
   SHALL be red on the current Announcer cut.
3. The recorded cast SHALL be re-cut by the forge's deterministic stages from their recorded model
   outputs (no new model or image calls), every character SHALL pass the new check and its art
   geometry checks, the WebP copies (task 12) SHALL be regenerated for changed files, and any
   committed packs built from the art SHALL be rebuilt.
4. Malakor's house art SHALL NOT be changed; the report SHALL say what the check finds on it.
5. Before/after cutout frames for every changed character, at rest and through a turn and tilt;
   a provenance row describing the re-cut.
