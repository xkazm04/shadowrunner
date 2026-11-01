# Shadowrunner — visual evolution, Round 1 brief

## What this is
Shadowrunner (repo `C:\Users\kazda\Spooky\shadowrunner`, React app in `apps/web/src`) is entered in
Kiroween 2026, **Costume Contest** track: judged on visual creativity and level of execution. The
owner rates the current pages "around average". We run rounds of evolution: each round, every
page gets **three prototype variants** as standalone HTML/CSS. The owner picks one winner per page
at a glance, it becomes the new baseline, next round evolves from it.

The product: a haunted web atelier where a streamer forges an AI co-host. Type a description or
upload an image -> it becomes a living 2.5D face cut into layers, lit, breathing, blinking. Dress
it, give it a voice, put it on air on a haunted stage where it answers chat. The app is framed as
an old cellar TV set: pages are channels on a dial (CH 2 On air / landing, CH 3 Forge, CH 4
Characters, CH 6 Daemon, CH 9 Sealed) plus the full-screen stage (/air, hotkey O).

Read `.kiro/steering/product.md` in the repo. Non-negotiables you must keep in every variant:
- **The haunting is function.** Every spooky effect is bound to a real state (bulb dies when the
  engine is offline; ON AIR lamp is brightest when live; RECORDED badge on replay plane). Show the
  state that drives each effect; never pure decoration.
- **The face is the hero.** Where a character is shown, its face is the brightest, sharpest
  element on screen.
- **Readable dread.** Grime on surfaces, never on labels. Working text >= 14px, WCAG AA contrast.
  Every animation has a `prefers-reduced-motion` twin.
- Horror, not gore. No blood or body horror. No real people, no third-party brands/logos.
- Replay plane is the default: a "RECORDED" badge is visible. Data shown is fictional.

## Variant spread (each page gets all three)
- **A — Refine.** Keep the current page's concept and composition; raise execution to
  award level: lighting, materials, depth, typography, micro-motion, detail density. The "same
  page, done by a top studio" option.
- **B — Reimagine.** Same fiction (cellar, TV channels, broadcast), new composition and interaction
  model for the page. Rethink hierarchy and how the user moves through it.
- **C — Leap.** The risk option: a bold art direction or interaction idea that would make judges
  stop scrolling, still obeying every non-negotiable. Should be clearly different from A and B.

Make each variant a believable **working state** with real content (names, lines, numbers from
the assets below), not a wireframe. Give each one memorable moment (an orchestrated load sequence,
a reactive interaction, a light that responds) rather than scattered effects. Interactivity is
welcome (hover, tabs, a toggle that flips a state such as daemon online/offline and shows the
haunting respond).

## Technical rules for every variant file
- One self-contained file: `r1/<page>-<a|b|c>.html`, starting with `<!doctype html>`, `<meta
  charset>`, viewport meta. All CSS/JS inline. No JS libraries unless truly needed (then cdnjs,
  pinned exact version). Google Fonts allowed (`fonts.googleapis.com`) with fallback stacks. The
  current app uses Barlow Semi Condensed (display), Inter (body), Courier Prime (typed); you may
  change type if the variant calls for it.
- Images only from the shared folder via relative paths `../a/...` (no other hosts, no data URIs
  over ~50 KB). Canvas/SVG/CSS-generated art is encouraged for texture, noise, light, scanlines.
- In `<head>` include exactly:
  `<title>R1 · <Page> · <A|B|C></title>`
  `<meta name="sr-name" content="<2-4 word name for the variant>">`
  `<meta name="sr-pitch" content="<one sentence: what changed and why it wins>">`
- Design for a 1440x900 desktop viewport first (that is how it is triaged); it must also hold
  together from 1280x720 to 1920x1080 without overflow. No horizontal scroll.
- The page renders inside an iframe; do not rely on `window.top`, alerts or localStorage.
- Visible keyboard focus. Reduced-motion twins. No console errors.

## Shared assets (relative to the variant file: `../a/`)
- `plates/cellar-wide.webp` 1376x768 cellar wall, `crt-frontal.webp` 1200x896 old wooden TV
  frontal, `paper.webp` 512 tile, `portrait.webp`, `root-eye.webp` 768, `root-pile.webp` 1264x848
  (rotting gourds pile).
- `malakor/*.webp` — the flagship rig: layers on a 1024x1024 canvas. `malakor/layers.json` gives
  each layer's `bbox` [x,y,w,h] and `anchor` on that canvas, z-order and float params. Layers:
  background, torso, head, jaw, eye_l, eye_r, monocle, shard_c, shard_l1..l5, shard_r1..r5,
  crown (crown.webp is the whole crown), portrait.webp (flat, full). Position layers absolutely in
  % of a square stage (left = x/1024 etc.) to build a living face: breathing torso, bobbing head,
  floating shards, blinking/glowing eyes, jaw moving with speech. `malakor/bible.md` is the
  character bible (voice, lore) — read it for copy.
- `cast/<slug>.webp` 768px portraits: malakor, announcer-of-dead-air, lantern-warden, moth-widow,
  sister-vesper, understudy. `cast/PROMPTS.md` describes them.
- `forge/lantern-*.webp` the Lantern Warden's cut layers (background, torso, head, jaw, eye_l,
  eye_r, hat) — useful to show the forge's "cutting into layers" step.
- `show.json` — the recorded "malakor-night" show: audience chat lines and Malakor's answers.
- `current/<page>.webp` — screenshot of the page as it is today (1440x900).

## Process
1. Read the screenshot of your page (`triage/a/current/<page>.webp`, or the PNG in
   `scratchpad/shots/`) and skim the page's source in the repo for its real states and copy.
2. Decide the three directions before writing; make them distinct.
3. Write the three files.
4. Check each one once: screenshot at 1440x900 with Playwright. From
   `C:\Users\kazda\Spooky\shadowrunner\apps\web` the package `@playwright/test` resolves, so copy a
   small `.mjs` script into that folder, run it with `node`, delete it after. Load the variant via
   `file:///` URL, wait ~2.5 s, screenshot to the scratchpad, Read the image, fix what is broken
   (overlap, clipped text, missing images, unreadable labels), then stop. One look + one fix pass.
5. Do not touch the repo. Write only under the scratchpad `triage/r1/`.
6. Report: per variant the file path, name, one-line pitch, and which states it shows.
