// Control: the package name, and relative imports that stay inside one member (including a
// climb back to the member's own src/), are allowed by no-restricted-imports.
import { YAW_LIMIT_DEG } from "@sr/rig";
import { initialState } from "../driver/state.js";
import { PACKAGE } from "../src/index.js";
import { local } from "./local.js";

export const CLEAN = [YAW_LIMIT_DEG, initialState, PACKAGE, local];
