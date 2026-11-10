# Implementation plan: companion-lanes

Builder: Claude Opus subagents, one per task (owner's instruction, 2026-11-10); the Director
reviews, gates and logs. Tasks 1 and 2 run in parallel on disjoint files (design "Files and
ownership"); the wire types are committed before them.

- [ ] 1. Morph keys in the rig and the renderer
  - Validation, file lists, the morph plan, the WebGL morph program with sway, the Canvas 2D
    fallback, mouth mode `"morph"`, gaze and turn without eye layers, `docs/rig-format.md`.
  - _Requirements: 1.1-1.3, 2.1-2.3, 3.1-3.5_

- [ ] 2. The portrait builder, Iris and Bun
  - `tools/portrait-keys`, both character folders built from the Director's edits, packs.
  - _Requirements: 4.1-4.4, 5.1-5.3_

- [ ] 3. Capture, end-to-end proof and the creator
  - Capture page and script, control boards, end-to-end tests, creator checks, lab scenarios.
  - _Requirements: 6.1-6.3_

- [ ] 4. Iteration on the owner-facing result
  - Defects found on the boards and recordings, fixed and re-captured; docs, provenance, log.
  - _Requirements: 6.4_
