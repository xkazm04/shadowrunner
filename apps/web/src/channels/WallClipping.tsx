// CH 4, the newspaper clipping pinned beside the wall (costume 5.1, after `r1/characters-c.html`
// `.clip`): the listing of the chosen set. The copy is the listings' own: Malakor's from his bible
// (Listings.tsx), every later hour's from the preset notes through the cast, the vacant and sealed
// hours as the listings wrote them. Every call to action is a channel, its path from the manifest.
import type { MouseEvent, ReactElement } from "react";
import { PAGES, type PageId } from "../app/pages";
import { handleLinkClick } from "../app/router";
import type { ListedCharacter } from "./Listings";
import styles from "./Listings.module.css";
import type { WallSet } from "./ListingsWall";

export function pathOf(id: PageId): string {
  return PAGES.find((p) => p.id === id)?.path ?? "/";
}

export function channelOf(id: PageId): number | undefined {
  return PAGES.find((p) => p.id === id)?.channel;
}

/** The Forge with this character on its stage. */
export const forgePathFor = (slug: string): string => `${pathOf("creator")}?character=${encodeURIComponent(slug)}`;

/**
 * A click on a link carrying its own query: keep the visitor's other parameters (`?plane=replay`),
 * which the router only carries over for a target without one.
 */
function withCurrentQuery(to: string): string {
  if (typeof window === "undefined") return to;
  const url = new URL(to, window.location.href);
  for (const [key, value] of new URLSearchParams(window.location.search)) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function ChannelLink({ to, solid = false, path, children }: { to: PageId; solid?: boolean; path?: string; children: string }) {
  const href = path ?? pathOf(to);
  const channel = channelOf(to);
  return (
    <a
      href={href}
      className={solid ? `${styles.btn} ${styles.solid}` : styles.btn}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => handleLinkClick(event, path === undefined ? href : withCurrentQuery(href))}
    >
      {channel === undefined ? children : `${children} · CH ${channel}`}
    </a>
  );
}

/** "hat and a lit jaw. ..." -> "Hat and a lit jaw. ..." */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export interface HouseListing {
  epithet: string;
  blurb: string;
  facts: readonly (readonly [string, string])[];
}

export interface WallClippingProps {
  set: WallSet<ListedCharacter> | undefined;
  house: HouseListing;
  /** The clipping is being swapped (the old listing fades out first). */
  changing: boolean;
  /** The later hours did not load. */
  failed: boolean;
}

function Body({ set, house }: { set: WallSet<ListedCharacter>; house: HouseListing }): ReactElement {
  const head = (
    <>
      <p className={set.kind === "live" ? `${styles.slot} ${styles.now}` : styles.slot}>{set.slot}</p>
      <h2>{set.name}</h2>
    </>
  );
  if (set.kind === "live") {
    return (
      <>
        {head}
        <p className={styles.epithet}>{house.epithet}</p>
        <p className={styles.blurb}>{house.blurb}</p>
        <dl className={styles.spec}>
          {house.facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.actions}>
          <ChannelLink to="creator" solid path={forgePathFor(set.member?.slug ?? "malakor")}>
            Open in the Forge
          </ChannelLink>
          <ChannelLink to="landing">Watch</ChannelLink>
        </div>
      </>
    );
  }
  if (set.kind === "cast" && set.member !== undefined) {
    const { member } = set;
    const shows = member.teaches ?? member.showsOff;
    return (
      <>
        {head}
        {member.hook !== undefined && <p className={styles.blurb}>{sentence(member.hook)}</p>}
        {shows !== undefined && (
          <dl className={styles.spec}>
            <div>
              <dt>Shows off</dt>
              <dd>{sentence(shows)}</dd>
            </div>
          </dl>
        )}
        <div className={styles.actions}>
          <ChannelLink to="creator" solid path={forgePathFor(member.slug)}>
            Open in the Forge
          </ChannelLink>
        </div>
        <p className={styles.hint}>{`Forged · its rig waits in CH ${channelOf("creator") ?? 3}. Malakor holds the air until ${set.hour}.`}</p>
      </>
    );
  }
  if (set.kind === "sealed") {
    const nine = channelOf("sealed") ?? 9;
    return (
      <>
        {head}
        <p className={styles.epithet}>Nothing is broadcast on nine. The set still tunes to it.</p>
        <div className={styles.actions}>
          <ChannelLink to="sealed">{`Tune to ${nine}`}</ChannelLink>
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <p className={styles.epithet}>The last hour of the night is unclaimed.</p>
      <div className={styles.actions}>
        <ChannelLink to="forge-new" solid>
          Forge a character
        </ChannelLink>
      </div>
      <p className={styles.hint}>The set hisses because nothing is scheduled. Forge a character to claim the hour.</p>
    </>
  );
}

export function WallClipping({ set, house, changing, failed }: WallClippingProps): ReactElement {
  return (
    <aside className={styles.clip} aria-live="polite" aria-label="Listing for the chosen hour">
      <div className={styles.paper}>
        <div className={styles.mast}>
          <b>Tonight</b>
          <span>
            CUT FROM THE
            <br />
            CELLAR LISTINGS
          </span>
        </div>
        <div className={changing ? `${styles.swap} ${styles.changing}` : styles.swap}>
          {set !== undefined && <Body set={set} house={house} />}
          {failed && <p className={styles.hint}>The later hours did not come through. The Forge still has every character.</p>}
        </div>
      </div>
      <span className={styles.tack} aria-hidden="true" />
    </aside>
  );
}
