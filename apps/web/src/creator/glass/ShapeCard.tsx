// The Look tab's Shape card (character-control "Creator UI", requirement 3.2): the selected part's
// six reshape values (Look.shape) as labelled range inputs with read-outs, within SHAPE_LIMITS,
// with "Reset part" and "Reset all". A part is selected from the Layer stack or by a glass pick.
import { IDENTITY_SHAPE, SHAPE_LIMITS, type Look, type PartShape } from "@sr/rig";
import signal from "./Signal.module.css";
import styles from "./Look.module.css";

export interface ShapeRow {
  key: keyof PartShape;
  label: string;
  step: number;
  /** The read-out for a value. */
  show: (v: number) => string;
}

const times = (v: number): string => `×${v.toFixed(2)}`;
const share = (v: number): string => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** The six sliders, in the design's order: size, width, height, x, y, tilt. */
export const SHAPE_ROWS: readonly ShapeRow[] = [
  { key: "size", label: "size", step: 0.01, show: times },
  { key: "sx", label: "width", step: 0.01, show: times },
  { key: "sy", label: "height", step: 0.01, show: times },
  { key: "dx", label: "x", step: 0.005, show: share },
  { key: "dy", label: "y", step: 0.005, show: share },
  { key: "rot", label: "tilt", step: 1, show: (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}°` },
];

export interface ShapeCardProps {
  look: Look;
  /** The selected layer's name. */
  part?: string;
  onShape: (layer: string, value: Partial<PartShape>) => void;
  onReset: (layer: string) => void;
  onResetAll: () => void;
}

export function ShapeCard({ look, part, onShape, onReset, onResetAll }: ShapeCardProps) {
  const shape = part === undefined ? undefined : look.shape?.[part];
  const value = shape ?? IDENTITY_SHAPE;
  const any = look.shape !== undefined && Object.keys(look.shape).length > 0;
  return (
    <section className={signal.card} aria-labelledby="shape-title" data-card="shape">
      <h2 id="shape-title" className={signal.cardTitle}>
        SHAPE <small data-shape-part="">{part ?? "no part"}</small>
      </h2>
      {part === undefined ? (
        <p className={styles.note}>Pick a part on the glass or in the layer stack.</p>
      ) : (
        <div className={styles.sliders}>
          {SHAPE_ROWS.map((row) => {
            const id = `shape-${row.key}`;
            const [min, max] = SHAPE_LIMITS[row.key];
            const v = value[row.key];
            return (
              <div key={row.key} className={styles.slider}>
                <label htmlFor={id}>{row.label}</label>
                <input
                  id={id}
                  type="range"
                  min={min}
                  max={max}
                  step={row.step}
                  value={v}
                  data-shape={row.key}
                  onChange={(event) => {
                    const n = Number(event.currentTarget.value);
                    if (Number.isFinite(n)) onShape(part, { [row.key]: n });
                  }}
                />
                <output htmlFor={id}>{row.show(v)}</output>
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.resets}>
        <button type="button" className={signal.key} disabled={shape === undefined || part === undefined} onClick={() => part !== undefined && onReset(part)}>
          Reset part
        </button>
        <button type="button" className={signal.key} disabled={!any} onClick={onResetAll}>
          Reset all
        </button>
      </div>
    </section>
  );
}
