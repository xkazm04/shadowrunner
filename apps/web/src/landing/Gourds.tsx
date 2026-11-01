// The gourds are the remote (landing requirement 5). Five channel buttons cut from `root-pile`,
// one per manifest channel in ascending order, each with its number carved through and its title
// beneath. The current channel's gourd burns, the others hold an ember. Hovering or focusing a
// gourd writes that channel across the glass (onHover; Glass.tsx GlassCaption writes it). The legend box shows the keymap the shell actually binds (keys.ts).
// The light levels are CSS states on `--light`; the daemon-lost choreography (daemon.ts) moves
// them with per-gourd delays, and the flicker (fx/, motion only) scales them through `--flicker`.
import { useRef, type CSSProperties } from "react";
import { GLOBAL_BINDINGS, type KeyAction } from "../app/keys";
import { channelPages, PAGES, type PageDef, type PageId } from "../app/pages";
import type { Plane } from "../app/plane";
import { navigate } from "../app/router";
import type { Motion } from "../app/theme";
import { fadeMs, lightDelayMs, type DaemonState } from "./daemon";
import styles from "./Gourds.module.css";

/** root-pile's pixel space (assets/plates/root-pile.webp). */
export const PILE = { width: 1264, height: 848 } as const;

/** A gourd in the pile photo: centre and radius in PILE px. */
export interface Crop {
  cx: number;
  cy: number;
  r: number;
}

/** Which gourd of the pile each channel is cut from (the reference's CROPS). */
export const GOURD_CROPS: Readonly<Record<number, Crop>> = {
  2: { cx: 497, cy: 315, r: 75 },
  3: { cx: 655, cy: 562, r: 80 },
  4: { cx: 365, cy: 382, r: 85 },
  6: { cx: 558, cy: 400, r: 58 },
  9: { cx: 510, cy: 622, r: 82 },
};

/** The gourd's skin box in landscape world px; portrait (80x70) keeps the proportions. */
export const SKIN = { width: 150, height: 130 } as const;

/** Every gourd is drawn at the same radius on its skin, whatever its size in the pile. */
export const SKIN_RADIUS = 62;

/** CSS background geometry for a crop, in percentages of the skin box (so it scales with it). */
export interface CropBackground {
  /** background-size width (height is auto). */
  size: number;
  /** background-position x and y. */
  x: number;
  y: number;
}

/** Pure: the background that shows `crop` centred on the skin at SKIN_RADIUS. */
export function cropBackground(crop: Crop): CropBackground {
  const { cx, cy, r } = crop;
  if (![cx, cy, r].every(Number.isFinite) || r <= 0) {
    throw new RangeError(`cropBackground: needs finite cx, cy and r > 0 (got ${JSON.stringify(crop)})`);
  }
  const scale = SKIN_RADIUS / r;
  const width = PILE.width * scale;
  const height = PILE.height * scale;
  if (width <= SKIN.width || height <= SKIN.height) {
    throw new RangeError(`cropBackground: r ${r} draws the pile smaller than the skin`);
  }
  // A background-position of p% puts the image's p% point on the box's p% point.
  return {
    size: (width / SKIN.width) * 100,
    x: ((cx * scale - SKIN.width / 2) / (width - SKIN.width)) * 100,
    y: ((cy * scale - SKIN.height / 2) / (height - SKIN.height)) * 100,
  };
}

export type Light = "burn" | "ember" | "out";

/**
 * Pure: the current channel burns; every other gourd holds an ember. Once the daemon is dark every
 * gourd is out (its carving stays readable as a cold cut; Gourds.module.css).
 */
export function lightOf(page: PageDef, current: PageId | undefined, daemon: DaemonState = "online"): Light {
  if (daemon === "dark") return "out";
  return page.id === current ? "burn" : "ember";
}

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const pct = (v: number) => `${v.toFixed(4)}%`;

const DIAL = channelPages(PAGES);

/** The room's lights in daemon.ts order: the spiral pumpkin (position 0), then the gourds. */
export const LIGHTS = 1 + DIAL.length;

const ARROW: Readonly<Record<string, string>> = { ArrowLeft: "←", ArrowRight: "→" };

function keyOf(match: (action: KeyAction) => boolean): string | undefined {
  const hotkey = GLOBAL_BINDINGS.find((b) => match(b.action))?.hotkey;
  return hotkey === undefined ? undefined : (ARROW[hotkey] ?? hotkey);
}

const PREV = keyOf((a) => a.kind === "channel" && a.step === -1);
const NEXT = keyOf((a) => a.kind === "channel" && a.step === 1);
const BACK = keyOf((a) => a.kind === "back");
const SAMPLE = keyOf((a) => a.kind === "daemon-sample");

function Legend({ plane }: { plane: Plane }) {
  return (
    <div className={styles.legend} data-legend>
      <p className={styles.keys}>
        Channels{" "}
        {DIAL.map((page) => (
          <kbd key={page.id}>{page.hotkey}</kbd>
        ))}
        {PREV && NEXT && (
          <>
            {" · turn "}
            <kbd>{PREV}</kbd>
            <kbd>{NEXT}</kbd>
          </>
        )}
      </p>
      <p className={styles.keys}>
        {plane === "replay" && SAMPLE && (
          <>
            <kbd>{SAMPLE}</kbd>
            {" daemon sample · "}
          </>
        )}
        {BACK && (
          <>
            <kbd>{BACK}</kbd>
            {" back"}
          </>
        )}
      </p>
      <p className={styles.credit}>{`Stylised photos · ${plane === "replay" ? "simulated" : "live"} chat`}</p>
    </div>
  );
}

export interface GourdsProps {
  /** The page on the set; its gourd burns. */
  current: PageId | undefined;
  plane: Plane;
  /** The daemon's state (daemon.ts): dark puts every gourd out, relighting brings them back. */
  daemon?: DaemonState;
  motion?: Motion;
  /** Called with the hovered (or else focused) channel, and with undefined when there is none. */
  onHover?: (page: PageDef | undefined) => void;
}

export function Gourds({ current, plane, daemon = "online", motion = "reduced", onHover }: GourdsProps) {
  const pointer = useRef<PageDef | undefined>(undefined);
  const focus = useRef<PageDef | undefined>(undefined);
  const report = () => onHover?.(pointer.current ?? focus.current);
  const middle = (DIAL.length - 1) / 2;
  return (
    <>
      <nav className={styles.row} aria-label="Channels: five carved gourds in front of the set" data-daemon={daemon}>
        {DIAL.map((page, slot) => {
          const light = lightOf(page, current, daemon);
          const crop = GOURD_CROPS[page.channel ?? -1];
          const bg = crop && cropBackground(crop);
          const vars: Vars = {
            "--offset": slot - middle,
            // When this gourd goes out (dark) or comes back (relighting): daemon.ts schedules it.
            "--delay": `${lightDelayMs(daemon, slot + 1, LIGHTS, motion)}ms`,
            "--fade": `${fadeMs(daemon)}ms`,
          };
          if (bg) {
            vars["--crop-size"] = pct(bg.size);
            vars["--crop-x"] = pct(bg.x);
            vars["--crop-y"] = pct(bg.y);
          }
          return (
            <button
              key={page.id}
              type="button"
              className={styles.gourd}
              style={vars}
              data-channel={page.channel}
              data-light={light}
              data-flame
              data-status={page.status}
              aria-label={`Channel ${page.channel}, ${page.title}`}
              aria-current={page.id === current ? "page" : undefined}
              onClick={() => navigate(page.path)}
              onPointerEnter={() => {
                pointer.current = page;
                report();
              }}
              onPointerLeave={() => {
                pointer.current = undefined;
                report();
              }}
              onFocus={() => {
                focus.current = page;
                report();
              }}
              onBlur={() => {
                focus.current = undefined;
                report();
              }}
            >
              <span className={styles.pool} aria-hidden="true" />
              <span className={styles.body} aria-hidden="true">
                <span className={styles.skin} />
                <svg className={styles.carving} viewBox={`0 0 ${SKIN.width} ${SKIN.height}`} focusable="false">
                  {/* The cut: a dark hollow following the numeral, then its far wall catching light. */}
                  <text className={styles.cut} x="75" y="57" textAnchor="middle" dominantBaseline="central" fontSize="56">
                    {page.channel}
                  </text>
                  <text className={styles.wall} x="75" y="58.5" textAnchor="middle" dominantBaseline="central" fontSize="56">
                    {page.channel}
                  </text>
                  <text className={styles.lit} x="75" y="57" textAnchor="middle" dominantBaseline="central" fontSize="56">
                    {page.channel}
                  </text>
                </svg>
              </span>
              <span className={styles.name} aria-hidden="true">
                {page.title}
              </span>
            </button>
          );
        })}
      </nav>
      <Legend plane={plane} />
    </>
  );
}
