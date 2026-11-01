// The page manifest: the only declaration of pages (m0-spine requirement 3.1). The router, the
// keymap (keys.ts) and the navigation all derive from PAGES. Channel numbers, titles and
// subtitles follow the landing verdict, The Harvest Floor (spec landing, design.md).
export type PageStatus = "live" | "sealed";

export type PageId = "landing" | "creator" | "forge-new" | "air" | "characters" | "daemon" | "sealed";

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
  },
  { id: "daemon", title: "Daemon", path: "/daemon", hotkey: "6", status: "live", channel: 6, subtitle: "the carrier" },
  {
    id: "sealed",
    title: "Sealed",
    path: "/sealed",
    hotkey: "9",
    status: "sealed",
    channel: 9,
    subtitle: "not built yet",
    lore: "Nothing is broadcast on nine. Something tunes in anyway.",
  },
  { id: "air", title: "The stage", path: "/air", hotkey: "O", status: "live", subtitle: "full screen, for the stream" },
];

/** Pages on the dial, in ascending channel order. */
export function channelPages(pages: readonly PageDef[]): PageDef[] {
  return pages
    .filter((p): p is PageDef & { channel: number } => p.channel !== undefined)
    .sort((a, b) => a.channel - b.channel);
}
