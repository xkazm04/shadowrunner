// The Look tab's Palette card (character-control "Creator UI", requirement 2.4): the four lights
// (eye, glow, rim, mouth) and every colour region the forge found, by part. A chip opens the
// swatch ring (Ring.tsx) with a free colour picker under it; a recoloured region shows a reset dot.
// The light pins on the glass write the same Look.palette, so either place shows the other's pick.
//
// Decisions the spec leaves open:
// - One ring is open at a time, under the chip row; Esc or a press outside closes it.
// - The region the glass picked is marked (`aria-current`) but its ring is not opened, so a pick
//   never takes the focus from the glass.
// - perfection-pass task 9: memoised on the look's palette and regions alone (not the whole look),
//   so a shape or face drag skips it.
import { regionKey, type Layer, type Look, type Palette, type Rig } from "@sr/rig";
import { memo, useEffect, useState, type ReactNode } from "react";
import { lamp, Ring } from "./Ring";
import { LIGHT_LABELS, regionRing, ringOf, swatchName } from "./swatches";
import signal from "./Signal.module.css";
import styles from "./Look.module.css";

export const LIGHT_KEYS: readonly (keyof Palette)[] = ["eye", "glow", "rim", "mouth"];

export const NO_MOUTH_LIGHT = "no mouth light on this character";

/**
 * Whether the mouth light lands anywhere: a `cavity` region slot on any layer (a live forge paints
 * it into the head, director amendment of task 3) or a layer named `mouth_glow`.
 */
export function hasMouthLight(rig: Rig): boolean {
  return rig.layers.some((l) => l.name === "mouth_glow" || (l.regions?.slots.some((s) => s.id === "cavity") ?? false));
}

export interface PaletteCardProps {
  rig: Rig;
  /** The look's lights. */
  palette: Palette;
  /** The look's region colours. */
  regions: Look["regions"];
  onPalette: (key: keyof Palette, hex: string) => void;
  /** A null value resets the region to its paint. */
  onRegion: (key: string, hex: string | null) => void;
  /** The region the glass picked (`regionKey`). */
  selected?: string;
}

interface Open {
  id: string;
  label: string;
  value: string;
  colours: string[];
  pick: (hex: string) => void;
}

function Chip({ id, label, hex, disabled, current, onOpen }: { id: string; label: string; hex: string; disabled?: boolean; current?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.chip}
      style={lamp(hex)}
      data-chip={id}
      disabled={disabled}
      aria-current={current === true ? "true" : undefined}
      aria-label={`${label}: ${swatchName(hex)}`}
      onClick={onOpen}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}

export const PaletteCard = memo(function PaletteCard({ rig, palette, regions, onPalette, onRegion, selected }: PaletteCardProps) {
  const look = { palette, regions };
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const mouth = hasMouthLight(rig);
  const parts = rig.layers.filter((l): l is Layer & { regions: NonNullable<Layer["regions"]> } => l.regions !== undefined);

  // A press anywhere but the ring, its picker or a chip closes the ring.
  useEffect(() => {
    if (open === undefined) return undefined;
    const close = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest("[data-ring],[data-chip],[data-picker]") === null) setOpen(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const toggle = (next: Open): void => setOpen(open?.id === next.id ? undefined : next);
  const closeTo = (id: string): void => {
    setOpen(undefined);
    document.querySelector<HTMLButtonElement>(`[data-chip="${id}"]`)?.focus();
  };

  const ring = (o: Open): ReactNode => {
    const value = o.id.startsWith("light:") ? look.palette[o.id.slice(6) as keyof Palette] : (look.regions?.[o.id.slice(7)] ?? o.value);
    return (
      <div className={styles.ringHost} data-picker="">
        <Ring label={o.label} colours={o.colours} value={value} at={[50, 50]} onPick={o.pick} onClose={() => closeTo(o.id)} />
        <label className={styles.picker}>
          any colour
          <input type="color" value={value} aria-label={`${o.label}: any colour`} onChange={(event) => o.pick(event.currentTarget.value)} />
        </label>
      </div>
    );
  };

  return (
    <section className={signal.card} aria-labelledby="palette-title" data-card="palette">
      <h2 id="palette-title" className={signal.cardTitle}>
        PALETTE <small>{parts.length === 0 ? "lights" : `lights · ${parts.length} parts`}</small>
      </h2>
      <span className={styles.lbl}>Lights</span>
      <div className={styles.chips}>
        {LIGHT_KEYS.map((key) => {
          const id = `light:${key}`;
          const off = key === "mouth" && !mouth;
          return (
            <Chip
              key={key}
              id={id}
              label={LIGHT_LABELS[key]}
              hex={look.palette[key]}
              disabled={off}
              onOpen={() => toggle({ id, label: LIGHT_LABELS[key], value: look.palette[key], colours: ringOf(key, look.palette[key]), pick: (hex) => onPalette(key, hex) })}
            />
          );
        })}
      </div>
      {!mouth && <p className={styles.note}>{NO_MOUTH_LIGHT}</p>}
      {open?.id.startsWith("light:") === true && ring(open)}
      <span className={styles.lbl}>Regions</span>
      {parts.length === 0 ? (
        <p className={styles.note}>No colour regions on this character yet.</p>
      ) : (
        <ul className={styles.regions}>
          {parts.map((layer) => (
            <li key={layer.name} data-region-layer={layer.name}>
              <span className={styles.part}>{layer.name}</span>
              <span className={styles.chips}>
                {layer.regions.slots.map((slot) => {
                  const key = regionKey(layer.name, slot.id);
                  const id = `region:${key}`;
                  const own = look.regions?.[key];
                  const hex = own ?? slot.hex;
                  return (
                    <span key={slot.id} className={styles.slot}>
                      <Chip
                        id={id}
                        label={slot.name}
                        hex={hex}
                        current={selected === key}
                        onOpen={() => toggle({ id, label: slot.name, value: slot.hex, colours: regionRing(hex), pick: (next) => onRegion(key, next) })}
                      />
                      {own !== undefined && (
                        <button type="button" className={styles.resetDot} aria-label={`Reset ${slot.name} to its paint`} data-reset={key} onClick={() => onRegion(key, null)} />
                      )}
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open?.id.startsWith("region:") === true && ring(open)}
    </section>
  );
});
