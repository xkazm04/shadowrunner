// forge-creator S2, repaint one face: the panel under FACES for the family being repainted
// (useRepaint.ts). Asking: the editable "Its eyes are ..." line, the "too subtle" chip and the
// estimate before anything is spent. Painting: a calm status (no animation). Candidate: the new face
// beside the current one on the glass (Show current / Show candidate), Accept / Decline. Refused:
// the gate's reading in words; there is nothing to accept. Failed: the message; an expired source
// says the window is over. Every line is working text (>= 14px) in the card's own colours.
import { REPAINT_ESTIMATE_USD } from "@sr/forge/faceRepaint";
import { gateLine } from "../forge/gateWords";
import signal from "./Signal.module.css";
import lookCss from "./Look.module.css";
import styles from "./Face.module.css";
import type { Repaint } from "./useRepaint";

export const EXPIRED_NOTE = "Repaint was open for 24 h after the forge.";
export const ESTIMATE = `$${REPAINT_ESTIMATE_USD.toFixed(2)}`;

const leftLine = (n: number): string => (n === 0 ? "No repaints left for this face." : `${n} ${n === 1 ? "repaint" : "repaints"} left for this face.`);

export function RepaintPanel({ repaint }: { repaint: Repaint }) {
  const { state } = repaint;
  if (state.step === "idle") return null;
  const { family } = state;
  return (
    <div className={styles.repaint} role="group" aria-labelledby="repaint-title" data-repaint={state.step}>
      <h3 id="repaint-title" className={styles.repaintTitle}>{`Repaint ${family}`}</h3>
      {state.step === "asking" && (
        <>
          <label className={styles.repaintField}>
            <span>Its eyes are</span>
            <input
              type="text"
              maxLength={200}
              value={state.eyes}
              data-repaint-eyes=""
              onChange={(event) => repaint.setEyes(event.currentTarget.value)}
            />
          </label>
          <div className={styles.repaintRow}>
            <button type="button" className={signal.key} aria-pressed={state.subtle} data-repaint-subtle="" onClick={() => repaint.setSubtle(!state.subtle)}>
              too subtle
            </button>
          </div>
          <p className={lookCss.note} data-repaint-estimate="">
            {`One image edit, about ${ESTIMATE}. Only this face is repainted; nothing else runs again.`}
          </p>
          <div className={styles.repaintRow}>
            <button type="button" className={signal.key} data-repaint-go="" onClick={repaint.paint}>
              {`Repaint for ${ESTIMATE}`}
            </button>
            <button type="button" className={signal.key} data-repaint-cancel="" onClick={repaint.cancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {state.step === "painting" && (
        <p className={lookCss.note} role="status" data-repaint-status="">
          {`Repainting the ${family} face. One edit; it can take up to a minute.`}
        </p>
      )}
      {state.step === "candidate" && (
        <>
          <p className={lookCss.note} role="status" data-repaint-status="">
            {`The new ${family} face passed the gate. Compare it on the glass, then keep it or not. ${leftLine(state.candidate.left.family)}`}
          </p>
          {state.preview.assets === undefined && <p className={lookCss.note}>The new face could not be drawn on the glass.</p>}
          <div className={styles.repaintRow}>
            <button type="button" className={signal.key} aria-pressed={state.shown === "current"} data-repaint-show="current" onClick={() => repaint.show("current")}>
              Show current
            </button>
            <button type="button" className={signal.key} aria-pressed={state.shown === "candidate"} data-repaint-show="candidate" onClick={() => repaint.show("candidate")}>
              Show candidate
            </button>
          </div>
          <div className={styles.repaintRow}>
            <button type="button" className={signal.key} data-repaint-accept="" onClick={() => void repaint.accept()}>
              Accept
            </button>
            <button type="button" className={signal.key} data-repaint-decline="" onClick={repaint.decline}>
              Decline
            </button>
          </div>
        </>
      )}
      {state.step === "refused" && (
        <>
          <p className={lookCss.note} role="status" data-repaint-status="" data-repaint-why={state.candidate.gate?.reason}>
            {`The new face did not pass: ${state.candidate.gate === undefined ? "the gate refused it" : gateLine(state.candidate.gate)}. Nothing was changed. ${leftLine(state.candidate.left.family)}`}
          </p>
          <button type="button" className={signal.key} data-repaint-close="" onClick={repaint.decline}>
            Close
          </button>
        </>
      )}
      {state.step === "failed" && (
        <>
          <p className={lookCss.note} role="status" data-repaint-status="">
            {state.expired ? `${EXPIRED_NOTE} Nothing was changed.` : `${state.message} Nothing was changed.`}
          </p>
          <button type="button" className={signal.key} data-repaint-close="" onClick={repaint.decline}>
            Close
          </button>
        </>
      )}
    </div>
  );
}
