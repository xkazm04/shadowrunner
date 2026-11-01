// The pitch, chalked on the left wall (costume requirement 3.1; prototype `.pitch`): the channel
// you are standing in, the one-line promise, and the way to the Forge with its real hotkey.
import { PAGES } from "../app/pages";
import { handleLinkClick } from "../app/router";
import styles from "./Pitch.module.css";

const HERE = PAGES.find((p) => p.id === "landing");
const FORGE = PAGES.find((p) => p.id === "creator");

export function Pitch() {
  return (
    <section className={styles.pitch} aria-labelledby="landing-pitch" data-pitch>
      {HERE && (
        <p className={styles.over}>
          {[`CH ${HERE.channel ?? HERE.hotkey}`, HERE.title, HERE.subtitle].filter(Boolean).join(" · ")}
        </p>
      )}
      <h1 id="landing-pitch" className={styles.title}>
        Something down here is <i>live.</i>
      </h1>
      <p className={styles.lede}>
        Forge your own AI co-host from a line of text or a sketch: a face that breathes, blinks and answers your chat on
        air. Malakor got here first.
      </p>
      {FORGE && (
        <a className={styles.go} href={FORGE.path} onClick={(event) => handleLinkClick(event, FORGE.path)}>
          <kbd>{FORGE.hotkey}</kbd> Forge yours
        </a>
      )}
    </section>
  );
}
