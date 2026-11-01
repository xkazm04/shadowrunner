// One palette colour (creator requirement 1.1): a row of preset lamps plus a free colour picker.
// The colours shown are the look's own data (inline), every other style is a role token.
import type { Palette } from "@sr/rig";
import { useId } from "react";
import styles from "./Customize.module.css";

export const PALETTE_LABELS: Readonly<Record<keyof Palette, string>> = {
  eye: "Eye light",
  glow: "Glow",
  rim: "Rim light",
  mouth: "Mouth light",
};

/** Preset lamps per key, after the reference's valves: the rig's own colour leads each row. */
export const PRESETS: Readonly<Record<keyof Palette, readonly string[]>> = {
  eye: ["#36d6c3", "#5ee06b", "#e2363b", "#9a5cf0", "#f0b23a", "#e8eef7"],
  glow: ["#f08a24", "#e2363b", "#4fb3f0", "#9a5cf0", "#5ec85e", "#efe3b8"],
  rim: ["#f5c08a", "#93a8f5", "#ef5f86", "#7fe0b8", "#f4f4f4", "#4545e6"],
  mouth: ["#33d9c7", "#f08a24", "#e2363b", "#9a5cf0", "#f0d060", "#e8eef7"],
};

const COLOUR_NAMES: Readonly<Record<string, string>> = {
  "#36d6c3": "teal", "#5ee06b": "green", "#e2363b": "red", "#9a5cf0": "violet", "#f0b23a": "amber",
  "#e8eef7": "white", "#f08a24": "orange", "#4fb3f0": "sky blue", "#5ec85e": "green", "#efe3b8": "candle",
  "#f5c08a": "peach", "#93a8f5": "periwinkle", "#ef5f86": "rose", "#7fe0b8": "mint", "#f4f4f4": "white",
  "#4545e6": "blue", "#33d9c7": "teal", "#f0d060": "gold",
};

export const colourName = (hex: string): string => COLOUR_NAMES[hex] ?? hex;

export interface PaletteFieldProps {
  name: keyof Palette;
  value: string;
  /** The rig's own colour, offered first. */
  original: string;
  onChange: (key: keyof Palette, value: string) => void;
}

export function PaletteField({ name, value, original, onChange }: PaletteFieldProps) {
  const labelId = useId();
  const label = PALETTE_LABELS[name];
  const swatches = [original, ...PRESETS[name].filter((c) => c !== original)].slice(0, 6);
  return (
    <div className={styles.valve} role="group" aria-labelledby={labelId}>
      <span id={labelId} className={styles.valveLabel}>
        {label}
      </span>
      <div className={styles.swatches}>
        {swatches.map((colour, i) => (
          <button
            key={colour}
            type="button"
            className={styles.swatch}
            style={{ backgroundColor: colour }}
            aria-pressed={value === colour}
            aria-label={`${label}: ${i === 0 ? `original (${colourName(colour)})` : colourName(colour)}`}
            onClick={() => onChange(name, colour)}
          />
        ))}
        <input
          type="color"
          className={styles.picker}
          value={value}
          aria-label={`${label}: any colour`}
          onChange={(event) => onChange(name, event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
