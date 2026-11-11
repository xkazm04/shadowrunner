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
// - forge-creator S2: a character kept from a live forge (`CharacterRecord.source`) has a Repaint
//   key per family (RepaintPanel, useRepaint): one paid edit of that face within the job's 24 h,
//   shown beside the current face and kept only on Accept. After the 24 h the keys are disabled
//   and say so; a recorded, replay or imported character has none.
// - perfection-pass task 9: the card reads only the look's retired faces (`retired`), and is
//   memoised on it, so a face slider drag (which keeps that map's identity) skips it.
import type { FaceGate } from "@sr/forge/faceGate";
import { EXPRESSION_FAMILIES, isRetired, resolveFace, type Emotion, type ExpressionFamily, type Look, type RetiredFaces, type Rig } from "@sr/rig";
import { memo, useCallback, useEffect, useState } from "react";
import signal from "./Signal.module.css";
import lookCss from "./Look.module.css";
import styles from "./Face.module.css";
import { gateLine } from "../forge/gateWords";
import type { RepaintWindow } from "../forge/repaint";
import { EXPIRED_NOTE, RepaintPanel } from "./RepaintPanel";
import type { Repaint } from "./useRepaint";

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

/** The rig fields the card reads; `morph` (companion-lanes) paints a family with a key on its track. */
export type FamiliesRig = Pick<Rig, "layers" | "face"> & { morph?: Rig["morph"] };

/** Each family's state for `rig` under `look`. A family is painted by a layer variant or by a morph key on its track. */
export function familyStates(rig: FamiliesRig, look: Pick<Look, "face">): Record<ExpressionFamily, FamilyState> {
  const own = resolveFace(rig, {});
  const now = resolveFace(rig, look);
  const out = {} as Record<ExpressionFamily, FamilyState>;
  for (const family of EXPRESSION_FAMILIES) {
    const painted = rig.layers.some((layer) => layer.variants?.[family] !== undefined) || (rig.morph?.keys.some((key) => key.track === family) ?? false);
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
  rig: FamiliesRig;
  /** The look's retired faces (`look.face.expression.faces`). */
  retired: RetiredFaces | undefined;
  onRetire: (family: ExpressionFamily, retired: boolean) => void;
  preview: ExpressionFamily | undefined;
  onShow: (family: ExpressionFamily) => void;
  reduced: boolean;
  /** S1: the forge's reading of each family it painted no face for (the kept record's `faceGate`). */
  gate?: FaceGate;
  /** S2: whether a face can be repainted (the record's source window), and the repaint itself. */
  windowState?: RepaintWindow;
  repaint?: Repaint;
}

export const FaceFamilies = memo(function FaceFamilies({ rig, retired: faces, onRetire, preview, onShow, reduced, gate, windowState = "none", repaint }: FaceFamiliesProps) {
  const repainting = repaint !== undefined && repaint.state.step !== "idle" && repaint.state.step !== "asking";
  const states = familyStates(rig, faces === undefined ? {} : { face: { expression: { faces } } });
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
              {windowState !== "none" && repaint !== undefined && (
                <button
                  type="button"
                  className={signal.key}
                  disabled={windowState === "expired" || repainting}
                  aria-pressed={repaint.state.step !== "idle" && repaint.state.family === family}
                  aria-label={`Repaint the ${family} face`}
                  {...(windowState === "expired" ? { "aria-describedby": "face-families-expired" } : {})}
                  data-repaint-family={family}
                  onClick={() => repaint.open(family)}
                >
                  Repaint
                </button>
              )}
              {reading !== undefined && (
                <span className={styles.familyWhy} data-family-why={reading.reason}>
                  {`Not painted: ${gateLine(reading)}.`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {windowState === "expired" && (
        <p id="face-families-expired" className={lookCss.note} data-repaint-expired="">
          {EXPIRED_NOTE}
        </p>
      )}
      {windowState === "open" && repaint !== undefined && <RepaintPanel repaint={repaint} />}
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
});
