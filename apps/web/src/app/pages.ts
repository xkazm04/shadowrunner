// The page manifest: the only declaration of pages (m0-spine requirement 3.1). The router, the
// keymap (keys.ts) and the navigation all derive from PAGES. Channel numbers, titles and
// subtitles follow the landing verdict, The Harvest Floor (spec landing, design.md).
export type PageStatus = "live" | "sealed";

export type PageId = "landing" | "creator" | "forge-new" | "air" | "characters" | "daemon" | "sealed" | "embed" | "overlay" | "studio";

export interface PageDef {
  id: PageId;
  title: string;
  path: `/${string}`;
  /** Written as shown to the user ("2", "O"); compared case-insensitively (keys.ts). */
  hotkey: string;
  status: PageStatus;
  /** The one line shown on the sealed door. Every `sealed` page carries one. */
  lore?: string;
  /** Channel on the set's dial. Pages without one (air, forge-new) are not on the dial. */
  channel?: number;
  subtitle?: string;
  /** The frame's bar keeps the breadcrumb for screen readers only; the room goes to the page. */
  bareBar?: true;
  /** Not on the channel strip (avatar-reach: the embed, overlay and studio pages). */
  offStrip?: true;
}

export const PAGES: readonly PageDef[] = [
  { id: "landing", title: "On air", path: "/", hotkey: "2", status: "live", channel: 2, subtitle: "the cellar set" },
  {
    id: "creator",
    title: "Forge",
    path: "/creator",
    hotkey: "3",
    status: "live",
    channel: 3,
    subtitle: "behind the back panel",
    bareBar: true,
  },
  // costume design.md "Route": the new-character rite, off the dial like the stage.
  { id: "forge-new", title: "Forge new", path: "/creator/new", subtitle: "a new character", hotkey: "N", status: "live" },
  {
    id: "characters",
    title: "Characters",
    path: "/characters",
    hotkey: "4",
    status: "live",
    channel: 4,
    subtitle: "tonight's listings",
    bareBar: true,
  },
  // CH 6 and CH 9 own the whole room like CH 3 and CH 4 (the vault plate; the dark set and its
  // glass): the bar keeps the strip and the badge, the breadcrumb is read, not shown.
  {
    id: "daemon",
    title: "Daemon",
    path: "/daemon",
    hotkey: "6",
    status: "live",
    channel: 6,
    subtitle: "the carrier",
    bareBar: true,
  },
  {
    id: "sealed",
    title: "Sealed",
    path: "/sealed",
    hotkey: "9",
    status: "sealed",
    channel: 9,
    subtitle: "not built yet",
    lore: "Nothing is broadcast on nine. Something tunes in anyway.",
    bareBar: true,
  },
  { id: "air", title: "The stage", path: "/air", hotkey: "O", status: "live", subtitle: "full screen, for the stream" },
  { id: "embed", title: "Embed", path: "/embed", hotkey: "E", status: "live", subtitle: "a character on any site", offStrip: true },
  { id: "overlay", title: "Overlay", path: "/overlay", hotkey: "B", status: "live", subtitle: "a character for OBS", offStrip: true },
  { id: "studio", title: "Studio", path: "/studio", hotkey: "V", status: "live", subtitle: "a character on video", offStrip: true },
];

/** Pages on the dial, in ascending channel order. */
export function channelPages(pages: readonly PageDef[]): PageDef[] {
  return pages
    .filter((p): p is PageDef & { channel: number } => p.channel !== undefined)
    .sort((a, b) => a.channel - b.channel);
}
