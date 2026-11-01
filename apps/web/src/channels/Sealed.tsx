// CH 9, the sealed door (landing requirement 8.2): a manifest page with status "sealed" renders
// this instead of a programme. As in the reference, the set still tunes to nine and shows snow
// with the channel's one line of lore (pages.ts `lore`), "NOT BUILT YET" in the static.
import type { PageDef } from "../app/pages";
import styles from "./Sealed.module.css";
import { Tube } from "./Tube";

export function Sealed({ page }: { page: PageDef }) {
  const kick = page.channel === undefined ? page.title : `Channel ${page.channel} · ${page.title}`;
  return (
    <section className={styles.page} data-door="sealed" aria-labelledby="page-title">
      <Tube label={`${kick} on the tube: static`} picture="snow">
        <p className={styles.kick}>{kick}</p>
        <h1 id="page-title" className={styles.big}>
          Not built yet
        </h1>
        {page.lore !== undefined && <p className={styles.lore}>{page.lore}</p>}
      </Tube>
    </section>
  );
}
