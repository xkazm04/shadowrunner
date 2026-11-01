// The glass (costume 3.1, `r1/creator-b.html` "Anatomy Under Glass"): the face through
// <AvatarCanvas> under a bell jar, with its four lights labelled where they live. A label opens a
// ring of lamps in place; a lamp writes Look.palette. A layer named by the rail is outlined over
// its box (a CSS box over the canvas, not a renderer change), and a click on a crown piece or an
// accessory lifts it off (Look.hidden). Every position comes from the rig (pins.ts).
//
// Decisions the spec leaves open:
// - The ring is a group of eight buttons; arrow keys walk it, Esc closes it (and is kept from the
//   shell, which would otherwise leave the channel), as does a press anywhere else.
// - The hit test for lifting runs on pointer moves without a React render (a data attribute on the
//   glass sets the cursor).
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import type { Gesture, Look, Palette, Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { boxOf, layerAt, lightPins, type Pin } from "./pins";
import { LIGHT_LABELS, ringOf, swatchName } from "./swatches";
import styles from "./Glass.module.css";

const LIFTABLE = ["crown", "accessory"] as const;

type Lamp = CSSProperties & Record<"--lamp", string>;
const lamp = (hex: string, extra: CSSProperties = {}): Lamp => ({ ...extra, "--lamp": hex });

export interface GlassProps {
  rig: Rig;
  look: Look;
  assets?: RigAssets;
  gesture?: Gesture;
  audio?: HTMLMediaElement;
  /** The layer outlined over the face (rail hover or focus). */
  highlight?: string;
  /** A lamp was chosen. Without it the labels are shown but do not open. */
  onPalette?: (key: keyof Palette, hex: string) => void;
  /** A click lifted a crown piece or accessory off (or put it back). */
  onLift?: (layer: string) => void;
  /** Bottom right on the glass. */
  chip?: ReactNode;
  /** Over the face: loading, an error. */
  children?: ReactNode;
}

function Ring({ pin, value, onPick, onClose }: { pin: Pin; value: string; onPick: (hex: string) => void; onClose: () => void }) {
  const group = useRef<HTMLDivElement>(null);
  const colours = ringOf(pin.key, value);
  const label = LIGHT_LABELS[pin.key];
  const x = Math.min(80, Math.max(20, pin.side === "start" ? pin.tag[0] + 18 : pin.tag[0] - 18));
  const y = Math.min(80, Math.max(20, pin.tag[1] + (pin.tag[1] < 55 ? 19 : -19)));
  useEffect(() => {
    const own = group.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? group.current?.querySelector("button");
    own?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(group.current?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div ref={group} className={styles.ring} style={{ insetInlineStart: `${x}%`, insetBlockStart: `${y}%` }} role="group" aria-label={`${label}: lamps`} onKeyDown={onKeyDown} data-ring="">
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

/** A polygon covering the glass with a hole at `box` (evenodd), to dim all but one layer. */
const holeAround = (b: { left: number; top: number; width: number; height: number }): string => {
  const [l, t, r, bt] = [b.left, b.top, b.left + b.width, b.top + b.height].map((v) => `${v.toFixed(2)}%`);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${r} ${t}, ${r} ${bt}, ${l} ${bt}, ${l} ${t})`;
};

export function Glass({ rig, look, assets, gesture, audio, highlight, onPalette, onLift, chip, children }: GlassProps) {
  const pins = useMemo(() => lightPins(rig), [rig]);
  const [open, setOpen] = useState<keyof Palette | undefined>(undefined);
  const [flash, setFlash] = useState<{ n: number; hex: string } | undefined>(undefined);
  const glass = useRef<HTMLDivElement>(null);
  const lit = highlight === undefined ? undefined : rig.layers.find((l) => l.name === highlight);
  const litBox = lit === undefined ? undefined : boxOf(rig, lit.bbox);

  // A press anywhere but the ring or a label closes the ring.
  useEffect(() => {
    if (open === undefined) return undefined;
    const close = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest("[data-ring],[data-callout]") === null) setOpen(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pointAt = (event: { clientX: number; clientY: number }): [number, number] | undefined => {
    const box = glass.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return undefined;
    return [((event.clientX - box.left) / box.width) * 100, ((event.clientY - box.top) / box.height) * 100];
  };

  return (
    <div className={styles.glass} ref={glass} style={lamp(look.palette.eye)}>
      <div
        className={styles.dome}
        onPointerMove={(event) => {
          const p = onLift === undefined ? undefined : pointAt(event);
          event.currentTarget.dataset.lift = p !== undefined && layerAt(rig, p, LIFTABLE) !== undefined ? "on" : "";
        }}
        onClick={(event) => {
          const p = onLift === undefined ? undefined : pointAt(event);
          const hit = p === undefined ? undefined : layerAt(rig, p, LIFTABLE);
          if (hit !== undefined) onLift?.(hit.name);
        }}
      >
        {assets !== undefined && (
          <div key={rig.id} className={styles.face}>
            <AvatarCanvas
              rig={rig}
              look={look}
              assets={assets}
              className={styles.canvas}
              {...(gesture === undefined ? {} : { gesture })}
              {...(audio === undefined ? {} : { audio })}
            />
          </div>
        )}
        {flash !== undefined && <span key={flash.n} className={styles.flash} style={lamp(flash.hex)} aria-hidden="true" />}
        {litBox !== undefined && (
          <>
            <span className={styles.dim} style={{ clipPath: holeAround(litBox) }} aria-hidden="true" />
            <span
              className={styles.outline}
              style={{ insetInlineStart: `${litBox.left}%`, insetBlockStart: `${litBox.top}%`, inlineSize: `${litBox.width}%`, blockSize: `${litBox.height}%` }}
              aria-hidden="true"
            />
          </>
        )}
        {children !== undefined && <div className={styles.over}>{children}</div>}
      </div>
      <span className={styles.sheen} aria-hidden="true" />
      <svg className={styles.leaders} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {pins.map((p) => (
          <g key={p.key} data-open={open === p.key ? "" : undefined}>
            <line x1={p.at[0]} y1={p.at[1]} x2={p.tag[0]} y2={p.tag[1]} />
            <circle cx={p.at[0]} cy={p.at[1]} r="1.4" />
          </g>
        ))}
      </svg>
      {pins.map((p) => {
        const hex = look.palette[p.key];
        const place: CSSProperties =
          p.side === "start" ? { insetInlineEnd: `${100 - p.tag[0]}%`, insetBlockStart: `${p.tag[1]}%` } : { insetInlineStart: `${p.tag[0]}%`, insetBlockStart: `${p.tag[1]}%` };
        return (
          <button
            key={p.key}
            type="button"
            className={styles.callout}
            style={lamp(hex, place)}
            data-callout={p.key}
            aria-expanded={onPalette === undefined ? undefined : open === p.key}
            disabled={onPalette === undefined}
            onClick={() => setOpen(open === p.key ? undefined : p.key)}
          >
            <i aria-hidden="true" />
            {LIGHT_LABELS[p.key]} <small>{swatchName(hex)}</small>
          </button>
        );
      })}
      {open !== undefined &&
        onPalette !== undefined &&
        pins
          .filter((p) => p.key === open)
          .map((p) => (
            <Ring
              key={p.key}
              pin={p}
              value={look.palette[p.key]}
              onPick={(hex) => {
                onPalette(p.key, hex);
                setFlash((f) => ({ n: (f?.n ?? 0) + 1, hex }));
              }}
              onClose={() => {
                setOpen(undefined);
                glass.current?.querySelector<HTMLButtonElement>(`[data-callout="${p.key}"]`)?.focus();
              }}
            />
          ))}
      {chip !== undefined && <span className={styles.chip}>{chip}</span>}
    </div>
  );
}
