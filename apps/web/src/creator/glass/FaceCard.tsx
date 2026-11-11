// The Face tab (face-control "UX/UI spec"): the character's face profile as three cards of labelled
// range inputs with read-outs, Gaze (range, saccade rate, the three gaze habits), Motion (drift,
// tilt, gesture, breath) and Expression (expression strength, mouth emotion or, on a morph rig,
// mouth size: companion-lanes round 6), each bounded by
// FACE_LIMITS and showing resolveFace(rig, look), so it starts at the character's own profile.
// A change writes Look.face (lookReducer "face"); "Reset to character default" deletes it.
// "Look around" cycles the glass's gaze (useLookAround) so the range can be seen; it is off and
// disabled under reduced motion.
// perfection-pass task 9: memoised on `look.face` alone, so a colour or shape drag skips it.
import { FACE_LIMITS, faceValue, MORPH_MOUTH_TRACKS, resolveFace, type FaceField, type Look, type Rig } from "@sr/rig";
import { memo } from "react";
import signal from "./Signal.module.css";
import lookCss from "./Look.module.css";
import styles from "./Face.module.css";

export interface FaceRow {
  field: FaceField;
  label: string;
  step: number;
  /** The read-out for a value. */
  show: (v: number) => string;
}

const times = (v: number): string => `×${v.toFixed(2)}`;
const percent = (v: number): string => `${Math.round(v * 100)}%`;

export interface FaceGroup {
  id: "gaze" | "motion" | "expression";
  title: string;
  /** The group in a slider's accessible name ("Gaze range"). */
  name: string;
  rows: readonly FaceRow[];
}

/** Every RigFace field, in three groups (every FACE_FIELDS entry appears once). */
export const FACE_GROUPS: readonly FaceGroup[] = [
  {
    id: "gaze",
    title: "GAZE",
    name: "Gaze",
    rows: [
      { field: "gaze.range", label: "range", step: 0.05, show: percent },
      { field: "gaze.saccadeRate", label: "saccades", step: 0.1, show: (v) => `${v.toFixed(1)}/s` },
      { field: "gaze.habits.chat", label: "to chat", step: 0.05, show: percent },
      { field: "gaze.habits.content", label: "to content", step: 0.05, show: percent },
      { field: "gaze.habits.host", label: "to host", step: 0.05, show: percent },
    ],
  },
  {
    id: "motion",
    title: "MOTION",
    name: "Motion",
    rows: [
      { field: "motion.drift", label: "drift", step: 0.05, show: times },
      { field: "motion.tilt", label: "tilt", step: 0.05, show: times },
      { field: "motion.gesture", label: "gesture", step: 0.05, show: times },
      { field: "motion.breath", label: "breath", step: 0.05, show: percent },
    ],
  },
  {
    id: "expression",
    title: "EXPRESSION",
    name: "Expression",
    rows: [
      { field: "expression.strength", label: "strength", step: 0.05, show: percent },
      { field: "mouth.emotion", label: "mouth emotion", step: 0.05, show: times },
      { field: "mouth.size", label: "mouth size", step: 0.05, show: times },
    ],
  },
];

const inputId = (field: FaceField): string => `face-${field.replace(/\./g, "-")}`;

/**
 * The rows that reach `rig`: a morph rig whose keys move the mouth (companion-lanes: Iris, Bun; the
 * mouth mode "morph") takes the mouth's emotion-free shape mix, so "mouth emotion" would change
 * nothing and is not shown; "mouth size" (round 6) is read only by the morph plan, so it shows only there.
 */
export function faceRows(group: FaceGroup, rig: { morph?: Rig["morph"] }): readonly FaceRow[] {
  const morphMouth = rig.morph?.keys.some((k) => (MORPH_MOUTH_TRACKS as readonly string[]).includes(k.track)) ?? false;
  return group.rows.filter((row) => row.field !== (morphMouth ? "mouth.emotion" : "mouth.size"));
}

export interface FaceCardProps {
  rig: Pick<Rig, "face"> & { morph?: Rig["morph"] };
  /** The look's face profile. */
  face: Look["face"];
  onFace: (field: FaceField, value: number) => void;
  onReset: () => void;
  /** The glass's gaze cycles through chat, content and host. */
  lookAround: boolean;
  onLookAround: (on: boolean) => void;
  /** Reduced motion: Look around is off and cannot be turned on. */
  reduced: boolean;
}

export const FaceCard = memo(function FaceCard({ rig, face: own, onFace, onReset, lookAround, onLookAround, reduced }: FaceCardProps) {
  const look = own === undefined ? {} : { face: own };
  const face = resolveFace(rig, look);
  const changed = look.face === undefined ? 0 : FACE_GROUPS.flatMap((g) => g.rows).filter((r) => faceValue(look.face, r.field) !== undefined).length;
  return (
    <>
      {FACE_GROUPS.map((group) => (
        <section key={group.id} className={signal.card} aria-labelledby={`face-${group.id}-title`} data-card={`face-${group.id}`}>
          <div className={styles.head}>
            <h2 id={`face-${group.id}-title`} className={signal.cardTitle}>
              {group.title}
            </h2>
            {group.id === "gaze" && (
              <button
                type="button"
                className={styles.around}
                aria-pressed={lookAround && !reduced}
                disabled={reduced}
                data-look-around=""
                onClick={() => onLookAround(!lookAround)}
              >
                Look around
              </button>
            )}
          </div>
          {group.id === "gaze" && reduced && <p className={lookCss.note}>Look around is off under reduced motion.</p>}
          <div className={lookCss.sliders}>
            {faceRows(group, rig).map((row) => {
              const id = inputId(row.field);
              const [min, max] = FACE_LIMITS[row.field];
              const v = faceValue(face, row.field) ?? min;
              const own = faceValue(look.face, row.field) === undefined;
              return (
                <div key={row.field} className={styles.row} data-own={own ? "" : undefined}>
                  <label htmlFor={id}>{row.label}</label>
                  <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={row.step}
                    value={v}
                    aria-label={`${group.name} ${row.label}`}
                    aria-valuetext={row.show(v)}
                    data-face={row.field}
                    onChange={(event) => {
                      const n = Number(event.currentTarget.value);
                      if (Number.isFinite(n)) onFace(row.field, n);
                    }}
                  />
                  <output htmlFor={id}>{row.show(v)}</output>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className={styles.footer}>
        <p className={lookCss.note} data-face-state="">
          {changed === 0 ? "The character's own face." : `${changed} ${changed === 1 ? "setting" : "settings"} changed from the character's own.`}
        </p>
        <button type="button" className={signal.key} disabled={changed === 0} data-face-reset="" onClick={onReset}>
          Reset to character default
        </button>
      </div>
    </>
  );
});
