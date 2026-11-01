// The ON AIR lightbox hanging from the beam (costume requirement 3.1; prototype `.sign`): lit red
// while the show is on, a cold dead box once the daemon is lost (daemon.ts isLost). It sways on its
// wire with motion, and buzzes on in the intro. `data-lamp` carries the state, as the bar's lamp
// did before it.
import { isLost, type DaemonState } from "./daemon";
import styles from "./Lightbox.module.css";

export interface LightboxProps {
  daemon: DaemonState;
}

export function Lightbox({ daemon }: LightboxProps) {
  const on = !isLost(daemon);
  return (
    <div className={styles.sign} aria-hidden="true">
      <span className={styles.wire} />
      <span className={styles.box} data-lamp={on ? "on" : "off"}>
        {on ? "ON AIR" : "OFF AIR"}
      </span>
    </div>
  );
}
