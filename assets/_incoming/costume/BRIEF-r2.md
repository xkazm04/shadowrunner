# Shadowrunner — visual evolution, Round 2 brief

Read the Round 1 brief first: it still holds (product, non-negotiables, technical rules, shared
assets, process): `triage/BRIEF.md`. This file overrides it where they differ.

## What changed
The owner triaged Round 1. Each page now has a **winner** that is the new baseline. Round 2 evolves
the winner along the owner's note. Do not restart from the old app screenshot.

Winners (files in `triage/r1/`; thumbnails in `triage/r1/thumbs/`):
- landing: `landing-c.html` "He Watches Your Torch"
- creator: `creator-b.html` "Anatomy Under Glass"
- characters: `characters-c.html` "The Wall of Sets"
- daemon: `daemon-c.html` "The Filament"
- air: `air-a.html` "The Lit Cellar"
- sealed: `sealed-c.html` (frozen, not in this round)

## Variant spread for Round 2
All three variants start from the winner (copy its file as your starting point, keep what made it
win) and answer the owner's note for that page in three clearly different ways:
- **A — Closest:** the most faithful answer to the note, polishing the winner along the way.
- **B — Alternative:** a different answer to the same note.
- **C — Bold:** the most ambitious answer; may change more of the winner where the note invites it.

## Navigation across pages
The owner wants a small channel navigation on every page for switching content (2 On air, 3 Forge,
4 Characters, 6 Daemon, 9 Sealed, O stage), replacing or adding to the plain "Back to the set"
header. The landing page's main menu is being redesigned this round; on other pages include a
compact channel switcher in the header that fits the page's look (the stage may hide it behind a
key or a hover, since it is captured for streams). Round 3 will unify all pages on one nav theme.

## Files
- Write `triage/r2/<page>-<a|b|c>.html`. Meta tags as before, but the title reads `R2 · ...`.
- New background plates (if any for your page) are in `../a/plates2/`; list the folder.
- Asset paths stay `../a/...` (the r2 folder sits beside r1).
