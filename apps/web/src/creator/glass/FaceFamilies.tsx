// The Face tab's FACES card (retire-a-face): the six expression families, each Painted (a layer has
// a variant for it and nothing retires it) or Procedural, with Retire / Restore and Show.
// - Retire writes `look.face.expression.faces` (lookReducer "retire"), so the choice is saved with
//   the look and goes on air and into packs with it. A family the rig paints no face for is
//   Procedural with its Retire disabled and says so; one the rig itself retires cannot be restored.
// - Show puts the glass at the family's strongest emotion for a moment (SHOW_MS), through a look
//   that is never saved, so the painted face and the procedural motion can be compared on the hero
//   face itself. Under reduced motion the swap is a still (the glass changes mood at once) that
//   holds until Show is pressed again, with no timed change.
// - forge-creator S1: a family with no painted face says why when the record carries the forge's
//   reading (`CharacterRecord.faceGate`): "Not painted: the eyes moved 7.2 px (limit 4)." Families
//   without one (the recorded cast, a record kept before S1) keep the general procedural note.
import type { FaceGate } from "@sr/forge/faceGate";
import { EXPRESSION_FAMILIES, isRetired, resolveFace, type Emotion, type ExpressionFamily, type Look, type Rig } from "@sr/rig";
import { useCallback, useEffect, useState } from "react";
import signal from "./Signal.module.css";
import lookCss from "./Look.module.css";
import styles from "./Face.module.css";
import { gateLine } from "../forge/gateWords";

/** How long Show holds a family on the glass (not under reduced motion). */
export const SHOW_MS = 2500;

/** The emotion Show puts on the glass for each family: its strongest. */
export const FAMILY_EMOTION: Readonly<Record<ExpressionFamily, Emotion>> = {
  joy: "delighted",
  showman: "theatrical",
  anger: "furious",
  gloom: "grim",
  smug: "smug",
  suspicion: "suspicious",
};

export type FamilyState = "painted" | "retired" | "rig-retired" | "none";

/** Each family's state for `rig` under `look`. */
export function familyStates(rig: Pick<Rig, "layers" | "face">, look: Pick<Look, "face">): Record<ExpressionFamily, FamilyState> {
  const own = resolveFace(rig, {});
  const now = resolveFace(rig, look);
  const out = {} as Record<ExpressionFamily, FamilyState>;
  for (const family of EXPRESSION_FAMILIES) {
    const painted = rig.layers.some((layer) => layer.variants?.[family] !== undefined);
    out[family] = !painted ? "none" : isRetired(own, family) ? "rig-retired" : isRetired(now, family) ? "retired" : "painted";
  }
  return out;
}

/** Show's state: the family on the glass (if any) and the toggle. */
export function useFacePreview(reduced: boolean): { preview: ExpressionFamily | undefined; show: (family: ExpressionFamily) => void } {
  const [preview, setPreview] = useState<ExpressionFamily | undefined>(undefined);
  useEffect(() => {
    if (preview === undefined || reduced) return undefined;
    const timer = setTimeout(() => setPreview(undefined), SHOW_MS);
    return () => clearTimeout(timer);
  }, [preview, reduced]);
  const show = useCallback((family: ExpressionFamily) => setPreview((now) => (now === family ? undefined : family)), []);
  return { preview, show };
}

const NOTE: Record<FamilyState, string> = {
  painted: "Painted",
  retired: "Procedural",
  "rig-retired": "Procedural",
  none: "Procedural",
};

export interface FaceFamiliesProps {
  rig: Pick<Rig, "layers" | "face">;
  look: Look;
  onRetire: (family: ExpressionFamily, retired: boolean) => void;
  preview: ExpressionFamily | undefined;
  onShow: (family: ExpressionFamily) => void;
  reduced: boolean;
  /** S1: the forge's reading of each family it painted no face for (the kept record's `faceGate`). */
  gate?: FaceGate;
}

export function FaceFamilies({ rig, look, onRetire, preview, onShow, reduced, gate }: FaceFamiliesProps) {
  const states = familyStates(rig, look);
  const why = (f: ExpressionFamily) => (states[f] === "none" ? gate?.[f] : undefined);
  const unpainted = EXPRESSION_FAMILIES.filter((f) => states[f] === "none" && why(f) === undefined);
  const retired = EXPRESSION_FAMILIES.filter((f) => states[f] === "retired").length;
  return (
    <section className={signal.card} aria-labelledby="face-families-title" data-card="face-families">
      <h2 id="face-families-title" className={signal.cardTitle}>
        FACES
      </h2>
      <p className={lookCss.note}>Painted faces repaint the art for a mood; procedural motion moves the base art instead.</p>
      <ul className={styles.families}>
        {EXPRESSION_FAMILIES.map((family) => {
          const state = states[family];
          const canRetire = state === "painted" || state === "retired";
          const reading = why(family);
          return (
            <li key={family} className={styles.family} data-family={family} data-state={state}>
              <span className={styles.familyName}>{family}</span>
              <span className={styles.familyState} data-family-state="">
                {NOTE[state]}
              </span>
              <button type="button" className={signal.key} aria-pressed={preview === family} aria-label={`Show ${family} on the glass`} data-show={family} onClick={() => onShow(family)}>
                Show
              </button>
              <button
                type="button"
                className={signal.key}
                disabled={!canRetire}
                aria-label={`${state === "retired" ? "Restore" : "Retire"} the ${family} face`}
                data-retire={family}
                onClick={() => onRetire(family, state !== "retired")}
              >
                {state === "retired" ? "Restore" : "Retire"}
              </button>
              {reading !== undefined && (
                <span className={styles.familyWhy} data-family-why={reading.reason}>
                  {`Not painted: ${gateLine(reading)}.`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {unpainted.length > 0 && (
        <p className={lookCss.note} data-families-note="">
          {`No painted face for ${unpainted.join(", ")}: this character shows ${unpainted.length === 1 ? "that mood" : "those moods"} by procedural motion only.`}
        </p>
      )}
      {EXPRESSION_FAMILIES.some((f) => states[f] === "rig-retired") && <p className={lookCss.note}>A face the character itself retired stays procedural.</p>}
      <p className={lookCss.note} data-families-state="">
        {retired === 0 ? "Every painted face is on." : `${retired} painted ${retired === 1 ? "face" : "faces"} retired to procedural motion.`}
        {reduced ? " Show holds a still until you press it again." : ""}
      </p>
    </section>
  );
}
