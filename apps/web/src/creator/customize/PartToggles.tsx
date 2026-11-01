// Part toggles (creator requirement 1.2): one per layer of kind accessory, crown or eye, writing
// `look.hidden`. A pressed toggle means the part is shown. When a rig has several crown layers
// (Malakor's eleven shards) a "Whole crown" toggle hides or shows them together, on top of the
// per-layer toggles; it dispatches the same per-layer toggles.
import type { Layer, LayerKind, Rig } from "@sr/rig";
import { CrownMap } from "./CrownMap";
import styles from "./Customize.module.css";

/** From this many crown pieces on, they are toggled on the crown map instead of as chips. */
export const MAP_FROM = 3;

const TOGGLED: readonly LayerKind[] = ["accessory", "crown", "eye"];

/** The layers that get a toggle, front-most kinds first, then by z. */
export function toggleLayers(rig: Rig): Layer[] {
  const rank = (l: Layer): number => TOGGLED.indexOf(l.kind);
  return rig.layers.filter((l) => TOGGLED.includes(l.kind)).sort((a, b) => rank(a) - rank(b) || a.z - b.z);
}

const SIDE: Readonly<Record<string, string>> = { l: "left", r: "right", c: "centre" };

/** "eye_l" -> "Left eye", "shard_r3" -> "Shard, right 3", "monocle" -> "Monocle". */
export function partLabel(name: string): string {
  const m = /^([a-z]+)_([lrc])(\d*)$/.exec(name);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const side = SIDE[m[2]] ?? m[2];
    if (m[1] === "eye") return `${side.charAt(0).toUpperCase()}${side.slice(1)} eye`;
    return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}, ${side}${m[3] ? ` ${m[3]}` : ""}`;
  }
  const words = name.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export interface PartTogglesProps {
  rig: Rig;
  hidden: readonly string[];
  onToggle: (layer: string) => void;
}

export function PartToggles({ rig, hidden, onToggle }: PartTogglesProps) {
  const layers = toggleLayers(rig);
  const isHidden = new Set(hidden);
  const crown = layers.filter((l) => l.kind === "crown");
  if (layers.length === 0) return <p className={styles.note}>This character has no removable parts.</p>;
  const crownShown = crown.some((l) => !isHidden.has(l.name));
  const mapped = crown.length >= MAP_FROM;
  const chips = mapped ? layers.filter((l) => l.kind !== "crown") : layers;
  return (
    <>
      <div className={styles.parts}>
        {crown.length > 1 && (
          <button
            type="button"
            className={`${styles.part} ${styles.partWhole}`}
            aria-pressed={crownShown}
            onClick={() => {
              for (const l of crown) if (isHidden.has(l.name) === !crownShown) onToggle(l.name);
            }}
          >
            <span className={styles.lamp} aria-hidden="true" />
            Whole crown
          </button>
        )}
        {chips.map((layer) => (
          <button
            key={layer.name}
            type="button"
            className={styles.part}
            aria-pressed={!isHidden.has(layer.name)}
            onClick={() => onToggle(layer.name)}
          >
            <span className={styles.lamp} aria-hidden="true" />
            {partLabel(layer.name)}
          </button>
        ))}
      </div>
      {mapped && <CrownMap layers={crown} hidden={isHidden} onToggle={onToggle} />}
    </>
  );
}
