// The channel strip (costume requirement 2; design.md "Shared seams"): the film strip from the
// prototype's "On other pages" card (`assets/_incoming/costume/r2/landing-c.html`, `.mini.strip`).
// One frame per strip page, derived from the manifest: the dial (2 3 4 6 9) and the off-dial pages
// that are not nested under another frame (the stage, O). The frame of the page you are on is lit;
// a nested page (Forge new, /creator/new) lights its parent (CH 3, /creator).
//
// Variants:
// - "frame": in the ChannelFrame bar on every page behind the set, in place of "Back to the set"
//   (Esc stays the shell's key, keys.ts).
// - "stage": for /air. Hidden for stream capture; it opens on hover of the top edge, on focus
//   (Tab reaches the frames, focus-within reveals them), or while `open` is true (the air lane
//   binds that to the C key and closes it on Esc).
//
// The lamp: while the daemon is lost the strip's lamp goes cold (`data-lamp="cold"`): every frame
// dims and none glows, but the numbers stay readable and every frame stays a working link.
import type { ReactElement } from "react";
import { channelPages, PAGES, type PageDef, type PageId } from "./pages";
import { handleLinkClick, normalizePath } from "./router";
import styles from "./ChannelStrip.module.css";

export type StripVariant = "frame" | "stage";

export interface ChannelStripProps {
  /** The page on screen (undefined: no signal, nothing lit). */
  current: PageId | undefined;
  /** The daemon is lost: the lamp goes cold. */
  daemonLost: boolean;
  variant: StripVariant;
  /** Stage only: hold the strip open (the air lane's C key). Ignored by "frame", which is always open. */
  open?: boolean;
  /** The manifest; tests pass their own. */
  pages?: readonly PageDef[];
}

/** True when `path` is `parent` or sits under it ("/" only matches itself). */
function within(path: string, parent: string): boolean {
  const p = normalizePath(path);
  const q = normalizePath(parent);
  return p === q || (q !== "/" && p.startsWith(`${q}/`));
}

/**
 * Pure: the strip's frames, in order: the dial ascending, then the off-dial pages that do not sit
 * under a dial page's path (the stage yes; Forge new, under /creator, no).
 */
export function stripPages(pages: readonly PageDef[] = PAGES): PageDef[] {
  const dial = channelPages(pages);
  const off = pages.filter((p) => p.channel === undefined && !dial.some((d) => within(p.path, d.path)));
  return [...dial, ...off];
}

/** Pure: the frame lit for `current`: its own, else the deepest frame whose path contains it. */
export function litFrame(current: PageId | undefined, pages: readonly PageDef[] = PAGES): PageId | undefined {
  const page = pages.find((p) => p.id === current);
  if (page === undefined) return undefined;
  const frames = stripPages(pages).filter((f) => within(page.path, f.path));
  frames.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length);
  return frames[0]?.id;
}

/** Pure: what a frame shows on its tab: the channel number, or the hotkey off the dial ("O"). */
export function frameTab(page: PageDef): string {
  return page.channel === undefined ? page.hotkey : String(page.channel);
}

/** Pure: a frame's accessible name, e.g. "Channel 4, Characters: tonight's listings" or "O, The stage: …". */
export function frameLabel(page: PageDef): string {
  const name = page.channel === undefined ? `${page.hotkey}, ${page.title}` : `Channel ${page.channel}, ${page.title}`;
  return page.subtitle === undefined ? name : `${name}: ${page.subtitle}`;
}

export function ChannelStrip({ current, daemonLost, variant, open = false, pages = PAGES }: ChannelStripProps): ReactElement {
  const lit = litFrame(current, pages);
  const classes = [styles.strip, variant === "stage" ? styles.stage : styles.frame].join(" ");
  return (
    <nav
      aria-label="Switch channel"
      className={classes}
      data-strip={variant}
      data-lamp={daemonLost ? "cold" : "warm"}
      data-open={variant === "stage" && open ? "" : undefined}
    >
      <ul className={styles.film}>
        {stripPages(pages).map((page) => (
          <li key={page.id}>
            <a
              href={page.path}
              className={styles.fr}
              data-frame={page.id}
              aria-label={frameLabel(page)}
              aria-current={page.id === lit ? "page" : undefined}
              title={`${frameTab(page)} · ${page.title}`}
              onClick={(event) => handleLinkClick(event, page.path)}
            >
              <span aria-hidden="true">{frameTab(page)}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
