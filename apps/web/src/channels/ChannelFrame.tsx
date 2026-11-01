// The frame every channel behind the set opens in (landing requirement 8.1; design.md "Files"):
// a "Back to the set · Esc" control and a breadcrumb `SHADOWRUNNER ▸ CH n · Name · subtitle`,
// as the reference's `.backbar`. Off the set it is the header: the shell hands it the RECORDED
// badge and the theme toggle, so no channel can lose them. Esc itself is the shell's key (keys.ts).
import type { ReactNode } from "react";
import type { PageDef } from "../app/pages";
import { handleLinkClick } from "../app/router";
import styles from "./ChannelFrame.module.css";

/** Pure: the breadcrumb's parts. `here` is "CH n · Name" (or the bare name off the dial). */
export function breadcrumb(page: PageDef): { root: string; here: string; subtitle?: string } {
  const here = page.channel === undefined ? page.title : `CH ${page.channel} · ${page.title}`;
  return page.subtitle === undefined ? { root: "SHADOWRUNNER", here } : { root: "SHADOWRUNNER", here, subtitle: page.subtitle };
}

/** Pure: the breadcrumb as one line of text (what a screen reader and the tests read). */
export function breadcrumbText(page: PageDef): string {
  const { root, here, subtitle } = breadcrumb(page);
  return `${root} ▸ ${here}${subtitle === undefined ? "" : ` · ${subtitle}`}`;
}

export interface ChannelFrameProps {
  page: PageDef;
  /** The shell's RECORDED badge (replay only). */
  badge?: ReactNode;
  /** The shell's theme toggle. */
  controls?: ReactNode;
  /** The channel itself, on the frame's dark room. */
  children: ReactNode;
}

export function ChannelFrame({ page, badge, controls, children }: ChannelFrameProps) {
  const { root, here, subtitle } = breadcrumb(page);
  return (
    <div className={styles.frame} data-channel-frame={page.id}>
      <header className={styles.bar}>
        <a href="/" className={styles.back} onClick={(event) => handleLinkClick(event, "/")} data-back>
          <span aria-hidden="true">◂</span> Back to the set <kbd>Esc</kbd>
        </a>
        <nav aria-label="Breadcrumb" className={styles.where}>
          <ol>
            <li>{root}</li>
            <li aria-current="page">
              <b>{here}</b>
              {subtitle !== undefined && <span>{` · ${subtitle}`}</span>}
            </li>
          </ol>
        </nav>
        <div className={styles.end}>
          {badge}
          {controls}
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
