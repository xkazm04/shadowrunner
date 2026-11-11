# Implementation plan: companion-lanes

Builder: Claude Opus subagents, one per task (owner's instruction, 2026-11-10); the Director
reviews, gates and logs. Tasks 1 and 2 run in parallel on disjoint files (design "Files and
ownership"); the wire types are committed before them.

- [x] 1. Morph keys in the rig and the renderer
  - Validation, file lists, the morph plan, the WebGL morph program with sway, the Canvas 2D
    fallback, mouth mode `"morph"`, gaze and turn without eye layers, `docs/rig-format.md`.
  - _Requirements: 1.1-1.3, 2.1-2.3, 3.1-3.5_

- [x] 2. The portrait builder, Iris and Bun
  - `tools/portrait-keys`, both character folders built from the Director's edits, packs.
  - _Requirements: 4.1-4.4, 5.1-5.3_

- [x] 3. Capture, end-to-end proof and the creator
  - Capture page and script, control boards, end-to-end tests, creator checks, lab scenarios.
  - _Requirements: 6.1-6.3_

- [x] 4. Iteration on the owner-facing result
  - Defects found on the boards and recordings, fixed and re-captured; docs, provenance, log.
  - _Requirements: 6.4_
  - Done in three rounds (design "Round 2 amendment", "Round 3 amendment", "As built"). Left open,
    named in the owner's verdict: Iris's widest mouth skews the lower lip near a quarter weight;
    Bun's downward gaze and blink-over-expression leave faint ghost lines; the blink dissolves
    rather than slides.
