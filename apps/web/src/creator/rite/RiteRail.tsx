// The layer stack waiting to be filled (costume 3.2, `r2/creator-a.html` `.rail`): one empty slot
// per layer, front-most first. A slot names its part when the forge finds it and fills with its
// cut-out when the knife lands. On replay the slots come from the recorded job's layers; on live the
// parts are not known until the job is done, so the slots wait unnamed until then. Once the face
// wakes, each slot's lamp lifts its layer off the face, as on the Forge page.
import type { Layer } from "@sr/rig";
import { layerWord, zLabel } from "../glass/LayerRail";
import anatomy from "../glass/Anatomy.module.css";
import type { SlotState } from "./riteClock";
import styles from "./Slots.module.css";

/** Slots shown on live before the forge says how many parts there are. */
export const UNKNOWN_SLOTS = 7;

export interface RiteRailProps {
  /** Known layers (the recorded job's, or the woken rig's); undefined while unknown. */
  layers?: readonly Layer[];
  slots: Readonly<Record<string, SlotState>>;
  /** Layer.file -> image URL. */
  thumbs: Readonly<Record<string, string>>;
  /** Set once the face is awake: the lamps work. */
  alive?: { hidden: readonly string[]; onToggle: (layer: string) => void; onHighlight: (layer: string | undefined) => void };
  /** The footnote: what the stack is cut from. */
  recipe: string;
}

export function RiteRail({ layers, slots, thumbs, alive, recipe }: RiteRailProps) {
  const rows = layers === undefined ? undefined : [...layers].sort((a, b) => b.z - a.z);
  const cut = rows === undefined ? 0 : rows.filter((l) => slots[l.name] === "cut").length;
  const off = new Set(alive?.hidden ?? []);
  return (
    <aside className={anatomy.rail} aria-labelledby="rite-rail-title" data-alive={alive === undefined ? undefined : ""}>
      <h2 id="rite-rail-title" className={anatomy.cardTitle}>
        LAYER STACK <small>{rows === undefined ? "0 cut" : `${cut} / ${rows.length} cut`}</small>
      </h2>
      <ol className={anatomy.rows} aria-live="polite" aria-relevant="text">
        {rows === undefined
          ? Array.from({ length: UNKNOWN_SLOTS }, (_, i) => (
              <li key={i} className={`${anatomy.row} ${styles.slot}`} data-slot="waiting">
                <span className={anatomy.z}>··</span>
                <span className={styles.slotThumb} />
                <span className={styles.slotName}>awaiting the knife</span>
                <span />
              </li>
            ))
          : rows.map((layer) => {
              const state = slots[layer.name] ?? "waiting";
              const url = thumbs[layer.file];
              return (
                <li
                  key={layer.name}
                  className={`${anatomy.row} ${styles.slot}`}
                  data-slot={state}
                  data-layer={layer.name}
                  onPointerEnter={() => alive?.onHighlight(layer.name)}
                  onPointerLeave={() => alive?.onHighlight(undefined)}
                >
                  <span className={anatomy.z}>{zLabel(layer.z)}</span>
                  <span className={styles.slotThumb}>{state === "cut" && url !== undefined && <img src={url} alt="" />}</span>
                  <span className={styles.slotName}>
                    {state === "waiting" ? "awaiting the knife" : layer.name}
                    <small>{state === "cut" ? layerWord(layer) : state === "found" ? `found · ${Math.round(layer.bbox[2])}×${Math.round(layer.bbox[3])}` : " "}</small>
                  </span>
                  {alive !== undefined && layer.kind !== "static" ? (
                    <button
                      type="button"
                      className={anatomy.lit}
                      aria-pressed={!off.has(layer.name)}
                      aria-label={`${layer.name} on the face`}
                      onFocus={() => alive.onHighlight(layer.name)}
                      onBlur={() => alive.onHighlight(undefined)}
                      onClick={() => alive.onToggle(layer.name)}
                    />
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
      </ol>
      <p className={styles.recipe}>{recipe}</p>
    </aside>
  );
}
