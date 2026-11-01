// Result type for fallible pure functions (.kiro/specs/rig-core/design.md, "Overview").

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };
