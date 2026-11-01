// Seeded violations: relative paths into another workspace member's src/ (expects
// no-restricted-imports once per specifier, 4 in all). Members import each other as `@sr/<name>`.
import { YAW_LIMIT_DEG } from "../../../packages/rig/src/index.js";
import type { Gesture } from "../../../packages/rig/src/index.js";
import { PACKAGE } from "../../rig/src";

export { GESTURE_DURATION_S } from "../../../packages/rig/src/index.js";
export const REACH: readonly [number, string, Gesture | undefined] = [YAW_LIMIT_DEG, PACKAGE, undefined];
