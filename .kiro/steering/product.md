---
inclusion: always
---
# Product: Shadowrunner

A haunted web atelier where a streamer forges an **AI co-host**: type a description or upload an
image, watch it become a living 2.5D face, dress it, give it a voice, and put it on air on a stage
where it answers chat. Flagship character: **Arch-Lich Malakor** (original fiction,
`assets/characters/malakor/bible.md`).

Entered in Kiroween 2026, **Costume Contest**: the haunting is function. Every spooky element is
bound to a real state (the bulb dies when the engine is offline; the ON AIR lightbox is the
brightest thing when live). Never decorate without a state behind it.

## Who it is for
Streamers who want an AI co-host character without rigging skills, GPUs or installs.

## Non-negotiables
- **Works on first visit with no keys.** The replay plane is the default; it is labelled
  "RECORDED" in the UI. Fabricated data carries `fictional: true`.
- **The face is the hero.** In the creator and on air, the character's face is the brightest,
  sharpest element on screen.
- **Readable dread.** Grime goes on surfaces, never on labels. Working text >= 14px equivalent,
  WCAG AA contrast, every animation has a `prefers-reduced-motion` twin.
- **No real people.** Uploaded images of real persons are refused (`refused_likeness`).
  No third-party marks or copyrighted material in UI, assets or video.
- Horror, not gore: dread, decay, wrongness. No blood or body horror.

## Out of scope (do not build unless a spec says so)
3D heads, accounts or cloud save, Twitch/OBS integration, moderation/simulator/judge parity,
voice cloning.
