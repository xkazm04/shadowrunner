// CH 4 Cellar Listings (landing requirement 8.2): tonight's programme on a parchment page, after
// the reference's `#guide`. Who is on now (Malakor, from his bible), the vacant hours, and the
// sealed channel. Every call to action is a channel: links derive their paths from the manifest.
import portrait from "../../../../assets/plates/portrait.webp";
import { PAGES, type PageId } from "../app/pages";
import { handleLinkClick } from "../app/router";
import styles from "./Listings.module.css";

function pathOf(id: PageId): string {
  return PAGES.find((p) => p.id === id)?.path ?? "/";
}

function channelOf(id: PageId): number | undefined {
  return PAGES.find((p) => p.id === id)?.channel;
}

function ChannelLink({ to, alt = false, children }: { to: PageId; alt?: boolean; children: string }) {
  const path = pathOf(to);
  return (
    <a
      href={path}
      className={alt ? `${styles.button} ${styles.alt}` : styles.button}
      onClick={(event) => handleLinkClick(event, path)}
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

export function Listings() {
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
          <p className={styles.time}>{`03:00 · ON AIR NOW · CH ${channelOf("landing") ?? 2}`}</p>
          <h2>Arch-Lich Malakor</h2>
          <p className={styles.role}>High Auditor of the Obsidian Spire, a lich of the Ninth Dark</p>
          <p className={styles.blurb}>
            Eleven centuries dead and still under-budgeted, he streams because the Ninth Dark now conquers by
            audience. He holds court, audits rival schemers from public records, and keeps a ledger of every
            regular.
          </p>
          <dl>
            {MALAKOR_FACTS.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            <ChannelLink to="creator">Open in the Forge</ChannelLink>
            <ChannelLink to="landing" alt>
              Watch
            </ChannelLink>
          </div>
        </div>
      </section>
      <section className={styles.slots} aria-label="Later tonight">
        <div className={styles.vacant}>
          <p className={styles.slotTime}>04:00 · VACANT</p>
          <h3>An empty slot</h3>
          <p>Describe a face or bring a picture. The forge cuts it into a rig and gives it this hour.</p>
          <ChannelLink to="creator">Forge a character</ChannelLink>
        </div>
        <div className={styles.vacant}>
          <p className={styles.slotTime}>05:00 · VACANT</p>
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
