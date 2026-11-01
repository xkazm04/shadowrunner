// The set (landing requirement 3): the frontal CRT plate standing on the cellar floor, its cabinet
// faded into floor shadow, the glass with the live picture (Glass.tsx), and the channel knob.
// The plate box is placed in world percentages from World.tsx SET_PLATE, so everything inside it
// (the glass clip included) scales with the plate at any size. While the daemon is lost the
// cabinet sinks into the dark with the room; only the dead glass keeps its faint light.
import type { CSSProperties } from "react";
import crtFrontal from "../../../../assets/plates/crt-frontal.webp";
import { channelPages, PAGES, type PageDef } from "../app/pages";
import type { Plane } from "../app/plane";
import { navigate } from "../app/router";
import type { Motion } from "../app/theme";
import type { DaemonState } from "./daemon";
import { Glass, type OnAirCharacter } from "./Glass";
import styles from "./Set.module.css";
import { PLATE } from "./superellipse";
import { SET_PLATE, WORLD_SIZE, type WorldLayout } from "./World";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const pct = (v: number) => `${v.toFixed(4)}%`;

/** The set's plate box (World.tsx SET_PLATE) as percentages of a world. */
export function plateBox(layout: WorldLayout): { x: number; y: number; width: number; height: number } {
  const world = WORLD_SIZE[layout];
  const p = SET_PLATE[layout];
  return {
    x: (p.x / world.width) * 100,
    y: (p.y / world.height) * 100,
    width: ((PLATE.width * p.scale) / world.width) * 100,
    height: ((PLATE.height * p.scale) / world.height) * 100,
  };
}

function plateVars(): Vars {
  const vars: Vars = {};
  for (const [layout, prefix] of [["landscape", "l"], ["portrait", "p"]] as const) {
    const box = plateBox(layout);
    vars[`--plate-${prefix}-x`] = pct(box.x);
    vars[`--plate-${prefix}-y`] = pct(box.y);
    vars[`--plate-${prefix}-w`] = pct(box.width);
    vars[`--plate-${prefix}-h`] = pct(box.height);
  }
  return vars;
}

/** The plate box in both layouts, as the custom properties `.plate` rules read. */
export const PLATE_VARS = plateVars();

const DIAL = channelPages(PAGES);

/** The knob's pointer per channel (the reference's KNOB, degrees). */
export const KNOB_ANGLE: Readonly<Record<number, number>> = { 2: -70, 3: -35, 4: 0, 6: 35, 9: 70 };

/** Pure: the channel after `channel` on the dial, wrapping round. */
export function nextChannel(channel: number, dial: readonly PageDef[] = DIAL): PageDef | undefined {
  const at = dial.findIndex((p) => p.channel === channel);
  return dial[(at + 1) % dial.length];
}

export interface TvSetProps {
  daemon: DaemonState;
  plane: Plane;
  motion?: Motion;
  /** The channel the set is tuned to (the landing is channel 2). */
  channel?: number;
  /** The hovered or focused gourd's channel, written on the glass. */
  hover?: PageDef;
  /** The user's own character once it is on air (requirement 3.5); Malakor otherwise. */
  character?: OnAirCharacter;
}

export function TvSet({ daemon, plane, motion = "reduced", channel = 2, hover, character }: TvSetProps) {
  const next = nextChannel(channel);
  const knob: Vars = { "--knob": `${KNOB_ANGLE[channel] ?? 0}deg` };
  return (
    <div className={styles.plate} style={PLATE_VARS} data-set data-daemon={daemon}>
      <div className={styles.cabShadow} aria-hidden="true" />
      {/* Clipped to the cabinet's own box, so the photo's masked-off margins never make it the
          largest paint: the cellar plate stays the LCP (requirement 9.5). */}
      <div className={styles.cabinetBox}>
        <img
          className={styles.cabinet}
          src={crtFrontal}
          width={1200}
          height={896}
          decoding="async"
          alt="A 1950s walnut television standing on the cellar floor (stylised photo)"
        />
      </div>
      <div className={styles.foot} aria-hidden="true" />
      <div className={styles.shade} aria-hidden="true" />
      <Glass daemon={daemon} plane={plane} motion={motion} hover={hover} character={character} />
      {next && (
        <button
          type="button"
          className={styles.knob}
          style={knob}
          aria-label={`Channel knob: turn to channel ${next.channel}, ${next.title}`}
          onClick={() => navigate(next.path)}
        />
      )}
    </div>
  );
}
