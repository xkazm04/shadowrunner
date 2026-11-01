// The magic-lantern slide tray at Malakor's feet: the channel menu of the landing (costume
// requirement 3.1, 3.2; prototype `.tray`). One hand-labelled glass slide per channel (slides.ts
// TRAY), each a real link to its page. Hovering or focusing a slide pulls it: it rises out of the
// tray and the lantern throws its still on the wall (Projection.tsx, through `onPull`). The torch
// backlights the slides near it (`--lit`, written by the composition root from torch.ts, no React
// render per move). The lantern runs on the carrier: once the daemon is dark the slides go cold one
// by one, right to left (daemon.ts lightDelayMs), and relight in a sweep; they stay working links.
// The legend under it names the keymap the shell actually binds (keys.ts).
import { useRef, type CSSProperties } from "react";
import { GLOBAL_BINDINGS, type KeyAction } from "../app/keys";
import type { PageDef, PageId } from "../app/pages";
import type { Plane } from "../app/plane";
import { handleLinkClick } from "../app/router";
import type { Motion } from "../app/theme";
import { fadeMs, lightDelayMs, type DaemonState } from "./daemon";
import { labelOf, LIGHTS, tabOf, tiltOf, TRAY } from "./slides";
import styles from "./SlideTray.module.css";
import { Still } from "./Still";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const ARROW: Readonly<Record<string, string>> = { ArrowLeft: "←", ArrowRight: "→" };

function keyOf(match: (action: KeyAction) => boolean): string | undefined {
  const hotkey = GLOBAL_BINDINGS.find((b) => match(b.action))?.hotkey;
  return hotkey === undefined ? undefined : (ARROW[hotkey] ?? hotkey);
}

const PREV = keyOf((a) => a.kind === "channel" && a.step === -1);
const NEXT = keyOf((a) => a.kind === "channel" && a.step === 1);
const BACK = keyOf((a) => a.kind === "back");
const SAMPLE = keyOf((a) => a.kind === "daemon-sample");

/** Pure: a slide's accessible name, e.g. "Channel 4, Characters: tonight's listings" or "O, The stage: …". */
export function slideName(page: PageDef): string {
  const name = page.channel === undefined ? `${page.hotkey}, ${page.title}` : `Channel ${page.channel}, ${page.title}`;
  return page.subtitle === undefined ? name : `${name}: ${page.subtitle}`;
}

export function Legend({ plane }: { plane: Plane }) {
  return (
    <div className={styles.legend} data-legend>
      <p className={styles.keys}>
        {TRAY.map((page) => (
          <kbd key={page.id}>{page.hotkey}</kbd>
        ))}
        {" channels"}
        {PREV && NEXT && (
          <>
            {" · "}
            <kbd>{PREV}</kbd>
            <kbd>{NEXT}</kbd>
            {" turn"}
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
      <p className={styles.credit}>{`Stylised art · ${plane === "replay" ? "fictional" : "live"} chat`}</p>
    </div>
  );
}

/** The pulled slide's name, chalked above the tray (decoration: the slide carries the name). */
export function Hint({ page }: { page: PageDef | undefined }) {
  if (page === undefined) return null;
  return (
    <p className={styles.hint} data-hint aria-hidden="true">
      {`${tabOf(page)} · ${page.title}`}
      {page.subtitle && <span className={styles.sub}>{` — ${page.subtitle}`}</span>}
    </p>
  );
}

export interface SlideTrayProps {
  /** The page on air; its slide is marked as the page you are on. */
  current: PageId | undefined;
  plane: Plane;
  daemon: DaemonState;
  motion: Motion;
  /** The pulled slide (hovered, or else focused). */
  pulled?: PageDef | undefined;
  /** Hears the pulled slide, and undefined when none is. */
  onPull?: (page: PageDef | undefined) => void;
}

export function SlideTray({ current, plane, daemon, motion, pulled, onPull }: SlideTrayProps) {
  const pointer = useRef<PageDef | undefined>(undefined);
  const focus = useRef<PageDef | undefined>(undefined);
  const report = () => onPull?.(pointer.current ?? focus.current);
  const cold = daemon === "dark";
  return (
    <>
      <Hint page={pulled} />
      <nav className={styles.tray} aria-label="Channels: a tray of magic-lantern slides" data-lantern={cold ? "cold" : "lit"}>
        <ul className={styles.slides}>
          {TRAY.map((page, i) => {
            const vars: Vars = {
              "--tilt": `${tiltOf(i)}deg`,
              "--i": i,
              // When this slide goes cold (dark) or warms again (relighting): daemon.ts schedules it.
              "--delay": `${lightDelayMs(daemon, i + 1, LIGHTS, motion)}ms`,
              "--fade": `${fadeMs(daemon)}ms`,
            };
            return (
              <li key={page.id}>
                <a
                  href={page.path}
                  className={styles.slide}
                  style={vars}
                  data-slide={page.id}
                  aria-label={slideName(page)}
                  aria-current={page.id === current ? "page" : undefined}
                  onClick={(event) => handleLinkClick(event, page.path)}
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
                  <span className={styles.frame} aria-hidden="true">
                    <Still page={page} className={styles.pic} />
                    <span className={styles.glint} />
                    <span className={styles.tab}>{tabOf(page)}</span>
                  </span>
                  <span className={styles.label} aria-hidden="true">
                    {labelOf(page)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <Legend plane={plane} />
    </>
  );
}
