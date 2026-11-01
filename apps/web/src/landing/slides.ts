// The magic-lantern slide tray, as data (costume requirement 3.1, 3.2): one hand-labelled slide per
// channel, in the channel strip's order (the dial ascending, then the stage), so the landing's big
// menu and the strip on every other page always list the same channels. Pure, no DOM.
import { stripPages } from "../app/ChannelStrip";
import { PAGES, type PageDef } from "../app/pages";

/** The slides, left to right. */
export const TRAY: readonly PageDef[] = stripPages(PAGES);

/**
 * The room's lights in daemon.ts order: the lantern (position 0: its beam and the face's spill),
 * then the slides left to right. Going dark the lantern dies first and the slides go out right to
 * left; relighting sweeps left to right.
 */
export const LIGHTS = 1 + TRAY.length;

/** Each slide sits a little askew in the tray (the prototype's TILT, degrees), straight when pulled. */
const TILTS = [-2.5, 1.8, -1.2, 2.4, -2, 1.4] as const;

/** Pure: the tilt of the slide at `index` (the pattern repeats past six). */
export function tiltOf(index: number): number {
  const i = Number.isInteger(index) && index >= 0 ? index % TILTS.length : 0;
  return TILTS[i] ?? 0;
}

/** Pure: what the slide's tab says: its channel number, or its hotkey off the dial ("O"). */
export function tabOf(page: PageDef): string {
  return page.channel === undefined ? page.hotkey : String(page.channel);
}

/** Pure: the slide's handwritten label: the title without a leading article ("The stage" is "Stage"). */
export function labelOf(page: PageDef): string {
  const bare = page.title.replace(/^the\s+/i, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * Pure: whether pulling `page` throws a picture on the wall while `current` is on air and the
 * lantern is `lit`. The channel you are standing in does not project (it is already the room).
 */
export function projects(page: PageDef | undefined, current: PageDef["id"] | undefined, lit: boolean): boolean {
  return lit && page !== undefined && page.id !== current;
}
