// rig/A (challenge-2026-11-17): the golden fault probe. A valid portrait rig (morphRig) changed in
// one place, then validated; the errors as {code, path, message, layer}, or "ok".
import { serializeRig } from "../serialize.js";
import { validateRig } from "../validate.js";
import { morphRig } from "./morphRig.js";

type Json = Record<string, unknown>;
/** The errors of morphRig() with one change, as {code, path, message, layer}. */
export function golden(change: (rig: Json, layers: Json[]) => void): unknown {
  const rig = JSON.parse(serializeRig(morphRig())) as Json & { layers: Json[] };
  change(rig, rig.layers);
  const result = validateRig(rig);
  return result.ok ? "ok" : result.errors.map((e) => ({ code: e.code, path: e.path, message: e.message, layer: e.layer }));
}
