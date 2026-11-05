// Scene driver registry: one entry per SceneArmId, one file per arm. WP2 replaces the S1 line
// with its factory (`S1: createS1,` importing from "./s1.js").
import type { SceneArmId, SceneDriver } from "../../contract.js";
import type { SceneContext, SceneDriverFactory } from "../types.js";
import { createS0 } from "./s0.js";
import { createS1 } from "./s1.js";

/** Every scene slot is built; kept for the next arm id. */
export function notBuilt(id: SceneArmId, what: string): SceneDriverFactory {
  return () => {
    throw new Error(`Scene arm ${id} is not built yet: it is ${what}. Run with scene S0, or add apps/lab/src/page/scene/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const SCENE_DRIVERS: Readonly<Record<SceneArmId, SceneDriverFactory>> = {
  S0: createS0,
  S1: createS1,
};

export function createSceneDriver(id: SceneArmId, ctx: SceneContext): SceneDriver {
  return SCENE_DRIVERS[id](ctx);
}
