# Verdict - 2026-11-07-forge-creator

Judge: claude-opus-5-5 (the caller; same family as one of the two seats, so peer scores are cited
where I disagree). Read from pool.md only, seats hidden. Roster: codex gpt-6.1-sol, claude
opus-5-5. The Google seat was skipped (this machine's agy has no Gemini 4). The codex seat's first
round-1 run crashed with an out-of-memory error, and its rerun completed.

## Triage

| id | premise (checked at) | value | conf | effort | score | fit | peers | note |
|---|---|---|---|---|---|---|---|---|
| P01 material face prompts | true: forge-expressions.ts:58 passes no attempt/material; expressions.ts:71 takes both | 4 | 4 | S | 16.0 | strong (codified craft) | 9 | offline evidence 24/54 vs human-eye failures |
| P02 wake at assembly + retries + brief resume | true: job.ts:67-68 rig only at done; useForgeJob.ts:20 300 s; :41 rejects mode brief while RitePage.tsx:184 sends it | 5 | 4 | M | 12.5 | strong | 7 | P12's correction is accepted: the eye step changes topology, so wake **after eyes**, not at assembly |
| P03 three drafts casting | true: gemini.ts:89-91,173-176 draft unused; quota.ts:37 forge 3/IP | 4 | 2 | M | 5.0 | connect | 5 | draft-model quality unmeasured |
| P04 keep/retire/repaint per face | true: face.ts:10 only expression.strength | 4 | 4 | M | 10.0 | strong | 8 | split into retire (C2) and repaint (S2) |
| P05 self-proof check + repair | true: empty/warnings not used live (forge-steps.ts:280-284) | 4 | 2 | L | 3.2 | strong | 3 | peers doubt a universal score; P13 argues for diagnostics over a score |
| P06 audition / procedural override | true: same as P04 | 4 | 4 | S | 16.0 | strong | 7 | cross-seat with P04 |
| P07 repaint one family | true: expressOne is per family (forge-expressions.ts:53) | 4 | 3 | M | 7.5 | strong | 5 | cross-seat with P04 |
| P08 persona to stage | true: cast.ts:51-56 castFor returns house (Malakor) when no recorded show; CharacterRecord has no persona (libraryStore.ts:30-42) | 5 | 5 | M | 15.6 | connect (the brief's output) | 8 | a defect-sized gap in the product promise |
| P09 signature acts | true: briefParts.ts:99 strips event clauses | 4 | 2 | L | 3.2 | strong (named parts) | 5 | superseded by P10's cue-word binding |
| P10 = P08+P09 | true (cast.ts, keep.ts, briefParts.ts) | 5 | 3 | L | 6.0 | strong | - | split: the sheet goes to C4, acts to L1 |
| P11 = P07+P06+P01+P04 | true: gate numbers only reach console.warn (forge-expressions.ts:71,78) | 4 | 4 | M | 10.0 | strong | - | supplies S1 (reasons) and the repaint prompt selection in S2 |
| P12 = P02+P04+P06+P07 | true: faceEyes socketing changes layers | 4 | 3 | L | 4.8 | strong | - | its topology point is folded into C1; the full revision manager is too heavy |
| P13 = P03+P05 | true | 4 | 2 | M | 5.0 | connect | - | lead for L2 |

## Clusters

- **Face approval** (cross-seat, the strongest signal): P04 + P06 + P07 + P11 + P12, split into
  C2 (retire, client-only), S1 (gate reasons) and S2 (repaint one family).
- **Better live faces**: P01 + P02(c) + P11's material line, giving C3.
- **Faster, safer forge tail**: P02 + P12's topology correction, giving C1.
- **The co-host is the brief's character**: P08 + P10(1), giving C4. Acts P09 + P10(2) give L1.
- **Casting before spending**: P03 + P13, giving L2. P05 gives L3.

## Left out

- P12's full immutable revision/topology manager: C1 avoids the problem by waking after the eye
  step, when the only remaining changes are additive variant patches.
- P05's universal parity score as a shipped number (kept only as leap L3, with diagnostics first),
  because peers rated it 3/10 and P13 argues persuasively against an unsupported score.
- The live A/B success criteria (P01, P03, P11) are not gates: they need keys and spend. Each item's
  gate check is the fake-provider test, and the live A/B is a follow-up measurement.
