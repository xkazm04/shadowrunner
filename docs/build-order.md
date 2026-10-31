# Build order (orchestrator plan)

Each line is one `scripts/kiro-task.sh <spec> <task>` dispatch; parallel lanes share no files.

1. `m0-spine` 1 -> 6 (sequential; creates the workspace, `@sr/*` package stubs, gates, deploy)
2. `rig-core` 1 -> 5 (the contract every package imports)
3. Contract stubs before fan-out: `forge-pipeline` task that creates `packages/forge/src/wire.ts`,
   and `voice-and-air` task that creates `VoiceId` in `@sr/engine` (so creator compiles alone)
4. Parallel lanes: `avatar-renderer` | `forge-pipeline` (spike first) | `voice-and-air` (engine + voice)
5. `creator` (consumes avatar, forge wire, engine VoiceId)
6. `voice-and-air` on-air page
7. `landing` - after the owner's contest verdict; then the creator's art-direction task
