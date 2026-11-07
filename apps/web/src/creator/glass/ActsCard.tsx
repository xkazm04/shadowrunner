// Signature acts in the creator (tiger L1): the character's acts (its rig's own `Layer.act`, plus a
// recorded cast character's acts compiled from its recorded brief, castActs.ts), one line each with
// a Rehearse button that plays the act on the glass (the AvatarCanvas `act` prop; under reduced
// motion the face plays the act's static twin). Shown only when the character has an act.
import { castSlug } from "@sr/engine";
import type { Rig } from "@sr/rig";
import { useCallback, useMemo, useState } from "react";
import { stageActs, withActs, type StageAct } from "../../air/acts";
import { castActs } from "../../air/castActs";
import type { ActFire } from "../../air/useActCue";
import styles from "./Signal.module.css";

/** The record's rig with its cast acts (the same object when it has none to add). */
export function useActedRig(id: string, rig: Rig): Rig {
  return useMemo(() => withActs(rig, castActs(castSlug(id))), [id, rig]);
}

/** The act prop for the glass and a rehearse callback: each press plays the layer's act once. */
export function useRehearse(): [ActFire | undefined, (layer: string) => void] {
  const [fire, setFire] = useState<ActFire | undefined>(undefined);
  const rehearse = useCallback((layer: string) => setFire((prev) => ({ layer, n: (prev?.n ?? 0) + 1 })), []);
  return [fire, rehearse];
}

/** `hand_r` -> `hand r`. */
const partName = (layer: string): string => layer.replace(/_/g, " ");

export function ActsCard({ rig, onRehearse }: { rig: Rig; onRehearse: (layer: string) => void }) {
  const acts: StageAct[] = useMemo(() => stageActs(rig), [rig]);
  if (acts.length === 0) return null;
  return (
    <section className={styles.card} aria-labelledby="acts-title" data-acts="">
      <h2 id="acts-title" className={styles.cardTitle}>
        SIGNATURE ACTS
      </h2>
      <ul className={styles.sheetLines}>
        {acts.map((a) => (
          <li key={a.layer} data-act={a.layer}>
            {partName(a.layer)}: on {a.cue.map((w) => `"${w}"`).join(" or ")}{" "}
            <button type="button" className={styles.key} onClick={() => onRehearse(a.layer)} aria-label={`Rehearse the ${partName(a.layer)} act`}>
              Rehearse
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
