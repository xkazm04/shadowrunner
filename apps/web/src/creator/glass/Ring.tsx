// The ring of lamps (costume 3.1, `r1/creator-b.html` `SW`): eight colours thrown out on a circle
// from a point, the current one pressed. Shared by the glass's light pins and the Look tab's
// Palette chips (character-control). The ring is a group of eight buttons; arrow keys walk it,
// Esc closes it (and is kept from the shell, which would otherwise leave the channel).
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { swatchName } from "./swatches";
import styles from "./Glass.module.css";

type Lamp = CSSProperties & Record<"--lamp", string>;
export const lamp = (hex: string, extra: CSSProperties = {}): Lamp => ({ ...extra, "--lamp": hex });

export interface RingProps {
  /** What the lamps colour ("Eye light", "robe"). */
  label: string;
  colours: readonly string[];
  value: string;
  /** The ring's centre, percent of its positioned parent. */
  at: [x: number, y: number];
  onPick: (hex: string) => void;
  onClose: () => void;
}

export function Ring({ label, colours, value, at, onPick, onClose }: RingProps) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const own = group.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? group.current?.querySelector("button");
    own?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(group.current?.querySelectorAll("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      ref={group}
      className={styles.ring}
      style={{ insetInlineStart: `${at[0]}%`, insetBlockStart: `${at[1]}%` }}
      role="group"
      aria-label={`${label}: lamps`}
      onKeyDown={onKeyDown}
      data-ring=""
    >
      <span className={styles.ringLabel} aria-hidden="true">
        {label.toUpperCase()}
      </span>
      {colours.map((hex, i) => (
        <button
          key={hex}
          type="button"
          className={styles.swatch}
          style={lamp(hex, { "--a": `${i * 45}deg` } as CSSProperties)}
          aria-pressed={hex === value.toLowerCase()}
          aria-label={`${label}: ${swatchName(hex)}`}
          onClick={() => onPick(hex)}
        />
      ))}
    </div>
  );
}
