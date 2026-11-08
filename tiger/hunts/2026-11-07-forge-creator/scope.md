# Scope - Forge + Creator (2026-11-07)

**Thesis:** turn the forge from a one-shot roll into a character the streamer directs. It is alive
as soon as its anatomy is cut. The streamer approves, retires or repaints its faces one at a time,
using the material recipe the cast was built with. It goes on air as the character the brief
described, not as Malakor in a new face.

Council: codex gpt-6.1-sol + claude opus-5-5 (two labs; Google seat skipped, no Gemini 4 on this
machine). 13 pool entries, all anchors valid, all premises verified.

## Core

| id | item | outcome | effort | verify (gate) | sources | depends |
|---|---|---|---|---|---|---|
| C1 | Wake after eyes, faces paint in | A valid character is kept and alive once the eye step finishes; the six faces arrive as additive patches; the 5-min client cap covers only time-to-awake; a reload mid-forge resumes brief-mode jobs | M | fake-clock Rite/useForgeJob test: record kept before the faces finish, survives the 300 s mark; reload during `expressing` of a brief job resumes; merge refuses non-additive changes | P02, P12 | - |
| C2 | Retire a face per family | The Face tab shows six families painted vs procedural; Retire sends a family to procedural on any record (recorded included), saved in Look and carried by packs and on air | S | poseLayers with `Look.faces {showman:"procedural"}` never lists showman; on Sir Vacant this reproduces the owner's 11-07 drop; survives reload + pack round-trip; 14 recorded jobs pose byte-identically | P06, P04, P11 | - |
| C3 | Material-aware live faces + retries | The brief writes an editable "Its eyes are ..." line; live expression and eye edits use it as `material`, and refused families get the STRICTER re-run (capped) | S-M | golden: briefs without `face` keep prompts byte-identical; fake editor refused at attempt 0 and passing at attempt 1 ends `ok`; charged edits <= 6 + cap | P01, P02c, P11 | - |
| C4 | Co-host on air as itself | Keeping a forge stores a character sheet (archetype, hook, <=3 example lines) in the record and pack; castFor uses it when no recorded show exists, with the Bind voice; replay plays a SCRIPTED loop of its lines | M | castFor for a forged record has its own name, hook, lines and voice, never MALAKOR_PERSONA's bible; survives reload + export/import; replay makes zero paid calls; existing packs still load | P08, P10 | - |

## Supporting

| id | item | outcome | effort | verify | sources | depends |
|---|---|---|---|---|---|---|
| S1 | Say why a face was refused | Gate readings (iris drift px, band mean, reason) are kept in the job and shown in the Face tab ("the eyes moved 7.2 px") | S | fake gate refusing joy for iris drift records `reason:"iris"` with the number, and the Face tab shows it | P11 | C2 |
| S2 | Repaint one face | On a live forge within 24 h, repaint one family: one edit, prompt chosen from the reason plus the material line, candidate shown beside current, merged only on Accept | M | fake provider: exactly one edit call, no portrait/parts/fill/eye calls; duplicate key spends once; Decline leaves record byte-identical; replay header -> zero paid calls | P07, P04, P11 | C1, C2, S1, C3 |

## Leaps

| id | item | outcome | effort | verify | sources | depends |
|---|---|---|---|---|---|---|
| L1 | Signature acts on cue words | The brief's event clauses ("slams on 'sold'") compile to a one-shot of the part's own motion, fired when the spoken line contains the cue word; an optional Rig/pack field | L | replay: Lot Ninety's hand fires on exactly the three "Sold" beats; poseLayers is byte-identical to idle after the act; rigs without acts are unchanged | P10, P09 | C4 |
| L2 | Cast from three drafts | Three draft portraits ($0.04 each) cut into provisional moving rigs; the streamer picks one before fill, eyes and faces are paid | M-L | fake provider: 3 draft + <=3 parts calls, no fill/eye/expr before the pick; finishing keeps the chosen portrait hash; replay twin | P03, P13 | - |
| L3 | Forge checks its own work | Pose sheet + detectors (holes, ghosts, empty parts) with one targeted re-ask; diagnostics, not a score | L | all 14 recorded jobs report zero blocking checks; each detector goes red on a seeded ledger regression | P05 | - |

## Left out

- P12's full revision/topology manager: C1 waking after eyes makes the remaining merges additive.
- A shipped "parity with the cast" score: peers rated it 3/10; L3 keeps it to diagnostics.
- Live A/B measurements (material vs blind, drafts vs first roll): follow-ups that need keys and
  spend, not gates.
