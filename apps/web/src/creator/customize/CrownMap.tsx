// The crown map (the reference's `#crownMap`): when a rig wears a crown of several pieces (Malakor's
// eleven shards), each piece's toggle is drawn where the piece floats, as a lit shard, over a
// sketch of the skull. These are the per-layer toggles of requirement 1.2, laid out as a map.
import type { Layer } from "@sr/rig";
import { partLabel } from "./PartToggles";
import styles from "./Customize.module.css";

/** Each layer's centre within the union of their boxes, in percent (x, y). */
export function mapPositions(layers: readonly Layer[]): { layer: Layer; x: number; y: number }[] {
  if (layers.length === 0) return [];
  const x0 = Math.min(...layers.map((l) => l.bbox[0]));
  const y0 = Math.min(...layers.map((l) => l.bbox[1]));
  const x1 = Math.max(...layers.map((l) => l.bbox[0] + l.bbox[2]));
  const y1 = Math.max(...layers.map((l) => l.bbox[1] + l.bbox[3]));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return layers.map((layer) => ({
    layer,
    x: ((layer.bbox[0] + layer.bbox[2] / 2 - x0) / w) * 100,
    y: ((layer.bbox[1] + layer.bbox[3] / 2 - y0) / h) * 100,
  }));
}

export interface CrownMapProps {
  layers: readonly Layer[];
  hidden: ReadonlySet<string>;
  onToggle: (layer: string) => void;
}

export function CrownMap({ layers, hidden, onToggle }: CrownMapProps) {
  return (
    <div className={styles.crownMap} role="group" aria-label="Crown pieces: press one to lift it off or put it back">
      <span className={styles.skull} aria-hidden="true" />
      <div className={styles.crownField}>
        {mapPositions(layers).map(({ layer, x, y }) => (
          <button
            key={layer.name}
            type="button"
            className={styles.shard}
            style={{ insetInlineStart: `${x}%`, insetBlockStart: `${y}%` }}
            aria-pressed={!hidden.has(layer.name)}
            aria-label={partLabel(layer.name)}
            title={partLabel(layer.name)}
            onClick={() => onToggle(layer.name)}
          />
        ))}
      </div>
    </div>
  );
}
