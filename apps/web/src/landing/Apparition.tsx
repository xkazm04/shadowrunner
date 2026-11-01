// Malakor projected out of the dark (costume requirement 3.1, 3.4; prototype `.apparition`): the
// live <AvatarCanvas> (Picture.tsx, a lazy chunk loaded after the page's own load, so the cellar
// plate stays the LCP) in a soft radial mask, under a faint phosphor grade and scanlines. His gaze
// follows the torch through the `lookAt` ref. The face is the brightest, sharpest thing in the
// room: nothing is laid over it but the grade.
// The daemon's states (daemon.ts) drive the picture: folding pinches it to a line and then a dot,
// dark leaves nothing, relighting opens it again. Once the room is dark the ghost note is chalked
// where he was, with the dead-air clock, after the last light has gone out (stareDelayMs).
import type { LookAtRef } from "@sr/avatar";
import { Component, lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Plane } from "../app/plane";
import type { Motion } from "../app/theme";
import styles from "./Apparition.module.css";
import { RESIDENT, type OnAirCharacter } from "./cast";
import { FOLD_MS, relightMs, stareDelayMs, type DaemonState } from "./daemon";
import { LIGHTS } from "./slides";
import { hms } from "./StatusBar";

const Picture = lazy(() => import("./Picture"));

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** The picture's fold timing (daemon.ts), shared by its layers. */
const FOLD_VARS: Vars = { "--fold": `${FOLD_MS}ms`, "--unfold": `${relightMs(LIGHTS)}ms` };

/** True once the page has loaded (plates first): the picture's chunk and images come after. */
function useAfterLoad(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (document.readyState === "complete") {
      setLoaded(true);
      return undefined;
    }
    const done = () => setLoaded(true);
    window.addEventListener("load", done, { once: true });
    return () => window.removeEventListener("load", done);
  }, []);
  return loaded;
}

/** A picture that cannot render (no GPU, no 2D, images missing) leaves the dark, not the page. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface GhostNoteProps {
  plane: Plane;
  motion: Motion;
  /** Seconds of dead air. */
  dead: number;
}

/** Chalked where the face was, once the room is dark. */
export function GhostNote({ plane, motion, dead }: GhostNoteProps) {
  const vars: Vars = { "--stare": `${stareDelayMs(LIGHTS, motion)}ms` };
  return (
    <div className={styles.ghost} style={vars} data-no-carrier>
      <p className={styles.gone}>he was right here</p>
      <p className={styles.small}>
        Dead air{" "}
        <b className={styles.clock} data-clock>
          {hms(dead)}
        </b>
        {" · "}
        {/* Only the replay sample answers D; on live the daemon has to come back by itself. */}
        {plane === "replay" ? "Press D to re-seat the daemon" : "Waiting for the daemon to return"}
      </p>
    </div>
  );
}

export interface ApparitionProps {
  daemon: DaemonState;
  plane: Plane;
  motion: Motion;
  /** Seconds of dead air (the composition root's broadcast clock). */
  dead: number;
  /** The torch, as the face's look-at point. */
  lookAt?: LookAtRef;
  /** The user's own character once it is on air; Malakor otherwise. */
  character?: OnAirCharacter;
}

export function Apparition({ daemon, plane, motion, dead, lookAt, character }: ApparitionProps) {
  const loaded = useAfterLoad();
  const name = character?.name ?? RESIDENT;
  return (
    <>
      <section className={styles.apparition} style={FOLD_VARS} aria-label={`${name}, live`} data-apparition data-daemon={daemon}>
        <div className={styles.picture} role="img" aria-label={`${name}, projected out of the dark (stylised, live rig); his eyes follow your light`}>
          {loaded && (
            <Quiet>
              <Suspense fallback={null}>
                <Picture
                  className={styles.face}
                  {...(character === undefined ? {} : { character })}
                  {...(lookAt === undefined ? {} : { lookAt })}
                />
              </Suspense>
            </Quiet>
          )}
          <div className={styles.phos} aria-hidden="true" />
          <div className={styles.scan} aria-hidden="true" />
          <div className={styles.wipe} aria-hidden="true" />
        </div>
      </section>
      {daemon === "dark" && <GhostNote plane={plane} motion={motion} dead={dead} />}
    </>
  );
}
