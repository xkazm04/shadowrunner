// The layer stack beside the face (costume 3.1, `r1/creator-b.html` `.rail`): every layer of the
// rig, front-most first, with its z, its cut-out, what it does, and a lamp that lifts it off the
// face or puts it back (Look.hidden). Hover or focus on a row outlines that layer on the glass.
// The rows slide in one after another when a character comes onto the glass. With `onSelect`
// (character-control) a row's name is a button that selects the part for the Shape card.
import { isEmissive, type Layer, type LayerKind } from "@sr/rig";
import { useEffect, useState, type CSSProperties } from "react";
import styles from "./Anatomy.module.css";
import look from "./Look.module.css";

/** What a layer does, as the rail says it. */
export const KIND_WORD: Readonly<Record<LayerKind, string>> = {
  static: "plate",
  body: "breathes",
  head: "bobs",
  jaw: "speaks",
  eye: "blinks · lit",
  iris: "looks · lit",
  accessory: "pulses · lit",
  crown: "floats",
};

/** The rail's word for a layer: its kind's, without "lit" when the layer gives no light (`Layer.emissive`). */
export const layerWord = (layer: Pick<Layer, "kind" | "emissive">): string => (isEmissive(layer) ? KIND_WORD[layer.kind] : KIND_WORD[layer.kind].replace(" · lit", ""));

/** Object URLs for a record's layer Blobs (by Layer.file), revoked when the blobs change. */
export function useBlobUrls(blobs: Readonly<Record<string, Blob>> | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (blobs === undefined || typeof URL.createObjectURL !== "function") return undefined;
    const made = Object.fromEntries(Object.entries(blobs).map(([file, blob]) => [file, URL.createObjectURL(blob)]));
    setUrls(made);
    return () => {
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
    };
  }, [blobs]);
  return urls;
}

export const zLabel = (z: number): string => String(z).padStart(2, "0");

export interface LayerRailProps {
  layers: readonly Layer[];
  /** Layer.file -> image URL. */
  thumbs: Readonly<Record<string, string>>;
  hidden: readonly string[];
  onToggle: (layer: string) => void;
  onHighlight: (layer: string | undefined) => void;
  /** The part selected for the Look tab. */
  selected?: string;
  /** A row's name was pressed: select that part. */
  onSelect?: (layer: string) => void;
}

export function LayerRail({ layers, thumbs, hidden, onToggle, onHighlight, selected, onSelect }: LayerRailProps) {
  const off = new Set(hidden);
  const rows = [...layers].sort((a, b) => b.z - a.z);
  return (
    <aside className={styles.rail} aria-labelledby="rail-title">
      <h2 id="rail-title" className={styles.cardTitle}>
        LAYER STACK <small>{layers.length} cut</small>
      </h2>
      <ol className={styles.rows}>
        {rows.map((layer, i) => {
          const url = thumbs[layer.file];
          return (
            <li
              key={layer.name}
              className={styles.row}
              style={{ "--i": i } as CSSProperties}
              data-layer={layer.name}
              onPointerEnter={() => onHighlight(layer.name)}
              onPointerLeave={() => onHighlight(undefined)}
            >
              <span className={styles.z}>{zLabel(layer.z)}</span>
              <span className={styles.thumb}>{url !== undefined && <img src={url} alt="" />}</span>
              {onSelect === undefined ? (
                <span className={styles.layerName}>
                  {layer.name}
                  <small>{layerWord(layer)}</small>
                </span>
              ) : (
                <button
                  type="button"
                  className={`${styles.layerName} ${look.railPick}`}
                  aria-pressed={selected === layer.name}
                  aria-label={`Select ${layer.name}`}
                  data-select={layer.name}
                  onClick={() => onSelect(layer.name)}
                >
                  {layer.name}
                  <small>{layerWord(layer)}</small>
                </button>
              )}
              {layer.kind === "static" ? (
                <span />
              ) : (
                <button
                  type="button"
                  className={styles.lit}
                  aria-pressed={!off.has(layer.name)}
                  aria-label={`${layer.name} on the face`}
                  onFocus={() => onHighlight(layer.name)}
                  onBlur={() => onHighlight(undefined)}
                  onClick={() => onToggle(layer.name)}
                />
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
