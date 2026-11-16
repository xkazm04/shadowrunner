# Implementation plan: talking-head

Builder: Kiro CLI per task, probed once; fallback Claude Opus builder under the same spec (owner,
2026-11-03). Task 1 first; tasks 2 and 3 in parallel on disjoint files, GPU shared via the lock.
The Director owns task 4, `apps/lab/src/contract.ts`, and this spec.

- [x] 1. Foundation: uv project, CLI, arm interface + stubs, Kokoro audio, post-processing (normalise, BiRefNet alpha, metrics), board, `noop` arm, tests, `docs/talking-head.md`
  - _Requirements: 1.1-1.5, 2.1, 3.1-3.5_
- [x] 2. Diffusion arms (InfiniteTalk dropped after measurement: design "As built"): `diffusion-it`, `diffusion-sa`, `realtime-fh`
  - _Requirements: 2.3-2.5_
- [x] 3. Rig arms: `baseline`, `dub-ls`, `a2f-keys`, timeline capture entry, A2F mapping
  - _Requirements: 2.2, 2.6, 2.7_
- [x] 4. Lab import, matrix run, board and verdict, docs/provenance/kiro-log (Director)
  - _Requirements: 3.6_
