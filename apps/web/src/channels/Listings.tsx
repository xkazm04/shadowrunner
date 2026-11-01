// CH 4 Cellar Listings (landing requirement 8.2): tonight's programme on a parchment page, after
// the reference's `#guide`. Who is on now (Malakor, from his bible), the rest of the cast in the
// later hours (landing task 12), the vacant hours, and the sealed channel. Every call to action is
// a channel: links derive their paths from the manifest; "Open in the Forge" opens that character
// in CH 3 (`/creator?character=<slug>`).
//
// The later hours are the creator's cast (the recorded forge jobs + the preset notes), loaded as
// their own chunk after the page, so the set's first load does not carry them. Their portraits are
// small stills, loaded lazily.
import { useEffect, useState, type MouseEvent } from "react";
import portrait from "../../../../assets/plates/portrait.webp";
import { PAGES, type PageId } from "../app/pages";
import { handleLinkClick } from "../app/router";
import type { GalleryEntry } from "../creator/gallery/entries";
import styles from "./Listings.module.css";

/** What the listings show of a cast member. */
export type ListedCharacter = Pick<GalleryEntry, "id" | "slug" | "name" | "portraitUrl" | "hook" | "teaches" | "showsOff" | "origin">;

export interface ListingsProps {
  /** The cast, house character included. Default: the creator's cast, as a lazy chunk. */
  loadCast?: () => Promise<readonly ListedCharacter[]>;
}

const loadCommittedCast = (): Promise<readonly ListedCharacter[]> => import("../creator/gallery/entries").then((m) => m.loadCast());

/** The house character's id: he is on now, written from his bible below. */
export const ON_NOW_ID = "malakor";
/** The hour Malakor is on; the cast follows on the hour. */
const ON_NOW_HOUR = 3;

function pathOf(id: PageId): string {
  return PAGES.find((p) => p.id === id)?.path ?? "/";
}

function channelOf(id: PageId): number | undefined {
  return PAGES.find((p) => p.id === id)?.channel;
}

/** `HH:00`, `n` hours after Malakor's. */
export const hourAfter = (n: number): string => `${String((ON_NOW_HOUR + n) % 24).padStart(2, "0")}:00`;

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

function ChannelLink({ to, alt = false, path, children }: { to: PageId; alt?: boolean; path?: string; children: string }) {
  const href = path ?? pathOf(to);
  return (
    <a
      href={href}
      className={alt ? `${styles.button} ${styles.alt}` : styles.button}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => handleLinkClick(event, path === undefined ? href : withCurrentQuery(href))}
    >
      {`${children} · CH ${channelOf(to) ?? "?"}`}
    </a>
  );
}

/** The listing card's facts, as the reference's definition list. */
export const MALAKOR_FACTS: readonly (readonly [string, string])[] = [
  ["Rig", "18 layers · bone, verdigris, eleven crown shards"],
  ["Voice", "Vault Baritone"],
  ["Moves", "10 emotions · 6 gestures"],
  ["Segments", "Audience Chamber · The Investigation · Table Read"],
];

/** "hat and a lit jaw. ..." -> "Hat and a lit jaw. ..." */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function LaterHour({ member, hour }: { member: ListedCharacter; hour: number }) {
  const shows = member.teaches ?? member.showsOff;
  return (
    <li className={styles.entry} data-character={member.slug}>
      {member.portraitUrl !== undefined && (
        <img className={styles.still} src={member.portraitUrl} width={112} height={112} loading="lazy" decoding="async" alt={`Portrait of ${member.name} (${member.origin})`} />
      )}
      <div className={styles.entryHead}>
        <p className={styles.slotTime}>{`${hourAfter(hour)} · LATER · CH ${channelOf("creator") ?? 3}`}</p>
        <h3>{member.name}</h3>
      </div>
      <div className={styles.entryText}>
        {member.hook !== undefined && <p className={styles.hook}>{sentence(member.hook)}</p>}
        {shows !== undefined && (
          <p className={styles.shows}>
            <b>Shows off</b> {sentence(shows)}
          </p>
        )}
        <ChannelLink to="creator" alt path={forgePathFor(member.slug)}>
          Open in the Forge
        </ChannelLink>
      </div>
    </li>
  );
}

export function Listings({ loadCast = loadCommittedCast }: ListingsProps) {
  const [cast, setCast] = useState<readonly ListedCharacter[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadCast().then(
      (list) => live && setCast(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [loadCast]);

  const house = cast?.find((m) => m.id === ON_NOW_ID);
  const later = cast?.filter((m) => m.id !== ON_NOW_ID) ?? [];
  const facts = house?.showsOff === undefined ? MALAKOR_FACTS : [...MALAKOR_FACTS, ["Shows off", house.showsOff] as const];
  const vacantAt = later.length + 1;

  return (
    <article className={styles.page} data-page="characters" aria-labelledby="page-title">
      <div className={styles.mast}>
        <h1 id="page-title">Cellar Listings</h1>
        <p>
          ALL NIGHT · CHANNELS 2 TO 9
          <br />
          CHARACTERS WHO STREAM
        </p>
      </div>
      <section className={styles.listing} aria-label="On air now">
        <figure>
          <img src={portrait} width={250} height={250} alt="Portrait of Arch-Lich Malakor (stylised)" />
          <figcaption>Source portrait, stylised. His rig was cut from it.</figcaption>
        </figure>
        <div>
          <p className={styles.time}>{`${hourAfter(0)} · ON AIR NOW · CH ${channelOf("landing") ?? 2}`}</p>
          <h2>Arch-Lich Malakor</h2>
          <p className={styles.role}>High Auditor of the Obsidian Spire, a lich of the Ninth Dark</p>
          <p className={styles.blurb}>
            Eleven centuries dead and still under-budgeted, he streams because the Ninth Dark now conquers by
            audience. He holds court, audits rival schemers from public records, and keeps a ledger of every
            regular.
          </p>
          <dl>
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            <ChannelLink to="creator" path={forgePathFor(house?.slug ?? ON_NOW_ID)}>
              Open in the Forge
            </ChannelLink>
            <ChannelLink to="landing" alt>
              Watch
            </ChannelLink>
          </div>
        </div>
      </section>
      <section className={styles.later} aria-labelledby="later-title">
        <h2 id="later-title" className={styles.laterTitle}>
          Later tonight
        </h2>
        {cast === undefined && !failed && <p className={styles.tuning}>Tuning in the later hours…</p>}
        {failed && <p className={styles.tuning}>The later hours did not come through. The Forge still has every character.</p>}
        {later.length > 0 && (
          <ol className={styles.entries}>
            {later.map((member, i) => (
              <LaterHour key={member.id} member={member} hour={i + 1} />
            ))}
          </ol>
        )}
      </section>
      <section className={styles.slots} aria-label="Unclaimed hours">
        <div className={styles.vacant}>
          <p className={styles.slotTime}>{`${hourAfter(vacantAt)} · VACANT`}</p>
          <h3>An empty slot</h3>
          <p>Describe a face or bring a picture. The forge cuts it into a rig and gives it this hour.</p>
          <ChannelLink to="creator">Forge a character</ChannelLink>
        </div>
        <div className={styles.vacant}>
          <p className={styles.slotTime}>{`${hourAfter(vacantAt + 1)} · VACANT`}</p>
          <h3>Before the boiler wakes</h3>
          <p>The last hour of the night is unclaimed.</p>
        </div>
        <div className={`${styles.vacant} ${styles.sealed}`}>
          <p className={styles.slotTime}>{`CH ${channelOf("sealed") ?? 9} · SEALED`}</p>
          <h3>Not built yet</h3>
          <p>Nothing is broadcast on nine. The set still tunes to it.</p>
          <a
            href={pathOf("sealed")}
            className={`${styles.button} ${styles.alt}`}
            onClick={(event) => handleLinkClick(event, pathOf("sealed"))}
          >
            {`Tune to ${channelOf("sealed") ?? 9}`}
          </a>
        </div>
      </section>
    </article>
  );
}
