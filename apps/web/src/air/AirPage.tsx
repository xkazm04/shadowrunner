// The on-air stage (voice-and-air task 5.3, requirement 4): Malakor's face at centre through
// @sr/avatar, the ON AIR lightbox, captions, and the chat column with the visitor's input. Full
// screen with no shell header, so the page works as a browser source for a stream. The shell
// hands in the RECORDED badge (replay) and the theme toggle, like on the set.
// Haunt bound to status (task 6): `data-state` on the stage root drives the dead line in CSS, and
// the fog density follows chat velocity through `--sr-haunt-fog`, the one inline style.
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import { MAX_CHAT_CHARS, type ChatMsg } from "@sr/engine";
import { defaultLook, type Look, type Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Plane } from "../app/plane";
import styles from "./air.module.css";
import { Captions } from "./Captions";
import { Chat } from "./Chat";
import { DeadLine } from "./DeadLine";
import { chatVelocity, FOG_SAMPLE_MS, fogFor, smooth } from "./fog";
import { loadRigAssets, MALAKOR_NAME, MALAKOR_PERSONA, malakorRig, malakorShow } from "./malakor";
import { OnAirLamp } from "./OnAirLamp";
import { useLoudness } from "./useLoudness";
import { useShow } from "./useShow";

export interface AirPageProps {
  plane: Plane;
  badge?: ReactNode;
  controls?: ReactNode;
}

/**
 * Rig layers the stage leaves out: the portrait's own backdrop. On air Malakor stands in the
 * cellar, not in front of a black card.
 */
export const STAGE_HIDDEN = ["background"];

/** jawOpen above this lights the VOICE tally; under the lower one it goes out (hysteresis). */
export const TALLY_ON = 0.12;
export const TALLY_OFF = 0.04;

type Loaded = { rig: Rig; assets: RigAssets } | "loading" | "failed";

function useMalakor(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>("loading");
  useEffect(() => {
    let alive = true;
    const rig = malakorRig();
    loadRigAssets(rig)
      .then((assets) => alive && setLoaded({ rig, assets }))
      .catch(() => alive && setLoaded("failed"));
    return () => {
      alive = false;
    };
  }, []);
  return loaded;
}

/** The VOICE tally: polls the meter once per frame, re-renders only when it flips. */
function useVoiced(jawOpen: (nowMs: number) => number, active: boolean): boolean {
  const [voiced, setVoiced] = useState(false);
  useEffect(() => {
    if (!active) {
      setVoiced(false);
      return undefined;
    }
    let raf = 0;
    let on = false;
    const tick = (now: number) => {
      const jaw = jawOpen(now);
      const next = on ? jaw > TALLY_OFF : jaw > TALLY_ON;
      if (next !== on) {
        on = next;
        setVoiced(next);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [jawOpen, active]);
  return voiced;
}

/** Whether the active theme haunts at all: its own --sr-haunt-fog is above zero (baseline: 0). */
function themeHaunts(): boolean {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sr-haunt-fog"));
  return Number.isFinite(value) && value > 0;
}

/** Fog density from chat velocity, sampled once a second; 0 when the theme does not haunt. */
export function useFog(chat: readonly ChatMsg[], now: () => number, haunts: () => boolean = themeHaunts): number {
  const [fog, setFog] = useState(0);
  const latest = useRef(chat);
  useEffect(() => {
    latest.current = chat;
  });
  useEffect(() => {
    let velocity = 0;
    const id = window.setInterval(() => {
      velocity = smooth(velocity, chatVelocity(latest.current, now()));
      const next = Math.round(fogFor(velocity, haunts()) * 100) / 100;
      setFog((prev) => (prev === next ? prev : next));
    }, FOG_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [now, haunts]);
  return fog;
}

export function AirPage({ plane, badge, controls }: AirPageProps) {
  const loaded = useMalakor();
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const loudness = useLoudness(audio);
  const show = useMemo(() => malakorShow(), []);
  const { snapshot, now, post, soundOn } = useShow({
    show,
    persona: MALAKOR_PERSONA,
    self: MALAKOR_NAME,
    audio,
    ensureRunning: loudness.ensureRunning,
  });
  const { status, caption, chat, sound } = snapshot;
  const speaking = status === "speaking";
  const voiced = useVoiced(loudness.jawOpen, speaking && caption?.voiced === true);
  const onAir = status === "on_air" || status === "speaking";
  const dead = status === "dead_line";
  const fog = useFog(chat, now);
  const fogStyle = { "--sr-haunt-fog": String(fog) } as CSSProperties;

  const emotion = speaking && caption ? caption.reply.emotion : "neutral";
  const look = useMemo<Look | undefined>(() => (typeof loaded === "object" ? { ...defaultLook(loaded.rig), hidden: STAGE_HIDDEN, emotion } : undefined), [loaded, emotion]);
  const gesture = speaking ? caption?.reply.gesture : undefined;

  return (
    <div className={styles.stage} data-page="air" data-state={status} data-plane={plane} data-sound={sound} style={fogStyle}>
      <div className={styles.room} aria-hidden="true">
        <span className={styles.bulb} />
        <span className={styles.fog} />
      </div>
      <section className={styles.set} aria-label={`${MALAKOR_NAME} on air`}>
        <header className={styles.top}>
          <OnAirLamp lit={onAir} voiced={voiced} />
          <div className={styles.slate}>
            <h1 className={styles.name}>Arch-Lich {MALAKOR_NAME}</h1>
            <p className={styles.from}>live from the Ninth Dark</p>
          </div>
          <div className={styles.controls}>
            {badge}
            {controls}
          </div>
        </header>
        <div className={styles.faceWell}>
          {typeof loaded === "object" && look ? (
            <AvatarCanvas
              rig={loaded.rig}
              look={look}
              assets={loaded.assets}
              className={styles.face}
              {...(loudness.source === undefined ? {} : { audio: loudness.source })}
              {...(gesture === undefined ? {} : { gesture })}
            />
          ) : (
            <p className={styles.faceNote}>{loaded === "failed" ? "The face did not load." : "Raising the dead..."}</p>
          )}
        </div>
        {dead ? <DeadLine /> : <Captions caption={speaking ? caption : undefined} speaker={MALAKOR_NAME} />}
        {sound === "blocked" && (
          <button type="button" className={styles.soundOn} onClick={soundOn}>
            Sound on
          </button>
        )}
      </section>
      <Chat chat={chat} self={MALAKOR_NAME} onPost={post} maxLength={MAX_CHAT_CHARS} {...(speaking && caption?.answered ? { answeredId: caption.answered.id } : {})} />
      <audio ref={setAudio} preload="auto" />
    </div>
  );
}

export default AirPage;
