// The two actions under the panel (creator requirement 6.2, the reference's `.pfoot`): "Put on air"
// to CH 2 (the signal action) and "Characters" to CH 4. Plain links through the router, labelled
// with their channel, taken from the page manifest so a renumbered dial cannot leave them stale.
import { PAGES } from "../app/pages";
import { handleLinkClick } from "../app/router";
import styles from "./CreatorPage.module.css";

const onAir = PAGES.find((p) => p.id === "landing");
const characters = PAGES.find((p) => p.id === "characters");

export function ChannelActions() {
  return (
    <nav className={styles.pfoot} aria-label="Channels from the forge">
      {onAir !== undefined && (
        <a href={onAir.path} className={`${styles.cta} ${styles.air}`} onClick={(event) => handleLinkClick(event, onAir.path)}>
          Put on air <kbd>CH {onAir.channel}</kbd>
        </a>
      )}
      {characters !== undefined && (
        <a href={characters.path} className={styles.cta} onClick={(event) => handleLinkClick(event, characters.path)}>
          Characters <kbd>CH {characters.channel}</kbd>
        </a>
      )}
    </nav>
  );
}
