// The on-air stage (voice-and-air 5.3; costume task 6, requirement 8): "Candles of the Catacomb".
// Malakor's face at centre of a symmetrical catacomb whose vanishing point sits behind his skull;
// the tunnel's far light is his backlight and swells with his real speech level; the ON AIR box
// hangs dead centre from the vault; captions are a centred lower third revealed word by word; the
// eight candles painted into the plate burn with chat velocity and flare for their chatter's post
// (useStageLights, candles.ts). Full screen with no shell header, so the page works as a browser
// source for a stream. The shell hands in the RECORDED badge, the theme toggle (the haunt toggle:
// a theme without haunt stills the candles) and the channel strip, which stays hidden for capture
// and opens on top-edge hover, focus, or the C key; Esc closes it before Esc may leave the page.
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import { MAX_CHAT_CHARS } from "@sr/engine";
import { defaultLook, type Look, type Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Plane } from "../app/plane";
import styles from "./air.module.css";
import { Captions } from "./Captions";
import { CatacombFront, CatacombLights, CatacombPlate } from "./Catacomb";
import { Chat } from "./Chat";
import { loadRigAssets, MALAKOR_NAME, MALAKOR_PERSONA, malakorRig, malakorShow } from "./malakor";
import { OnAirLamp, VoiceTally } from "./OnAirLamp";
import { useLoudness } from "./useLoudness";
import { useShow } from "./useShow";
import { useStageLights } from "./useStageLights";

export interface AirPageProps {
  plane: Plane;
  badge?: ReactNode;
  controls?: ReactNode;
  /** The stage's channel strip, rendered held open or not (the C key). */
  strip?: (open: boolean) => ReactNode;
}

/**
 * Rig layers the stage leaves out: the portrait's own backdrop. On air Malakor stands in the
 * catacomb, not in front of a black card.
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

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The strip's C key and its Esc. Listens in the capture phase so Esc is taken before the shell's
 * own Esc (back to the set): the first Esc closes the strip (and takes the focus out of it), only
 * a later one leaves. Keys typed into the chat box are not ours.
 */
export function useStripKeys(holder: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false);
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const box = holder.current;
      const focusInside = box !== null && document.activeElement instanceof HTMLElement && box.contains(document.activeElement);
      if (event.key === "Escape" && (isOpen.current || focusInside)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        if (focusInside && document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }
      if ((event.key === "c" || event.key === "C") && !event.repeat && !typing(event.target)) {
        event.preventDefault();
        const next = !isOpen.current;
        setOpen(next);
        if (next) (box?.querySelector<HTMLElement>('[aria-current="page"]') ?? box?.querySelector<HTMLElement>("a"))?.focus();
        else if (focusInside && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [holder]);
  return open;
}

export function AirPage({ plane, badge, controls, strip }: AirPageProps) {
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

  const root = useRef<HTMLDivElement>(null);
  const candles = useRef<(HTMLElement | null)[]>([]);
  const lights = useStageLights({ root, candles, chat, self: MALAKOR_NAME, now, jawOpen: loudness.jawOpen, speaking, dead });

  const stripBox = useRef<HTMLDivElement>(null);
  const stripOpen = useStripKeys(stripBox);

  // Every message he has answered keeps its mark for as long as it is on screen.
  const answeredNow = speaking ? caption?.answered?.id : undefined;
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (answeredNow !== undefined) setAnswered((prev) => (prev.has(answeredNow) ? prev : new Set(prev).add(answeredNow)));
  }, [answeredNow]);

  const emotion = speaking && caption ? caption.reply.emotion : "neutral";
  const look = useMemo<Look | undefined>(() => (typeof loaded === "object" ? { ...defaultLook(loaded.rig), hidden: STAGE_HIDDEN, emotion } : undefined), [loaded, emotion]);
  const gesture = speaking ? caption?.reply.gesture : undefined;

  return (
    <div ref={root} className={styles.stage} data-page="air" data-state={status} data-plane={plane} data-sound={sound}>
      <section className={styles.set} aria-label={`${MALAKOR_NAME} on air`}>
        {/* Inside the set: the set's size containment makes it the strip's frame, so the strip
            lowers from the vault on the set's centre line, over the lamp. */}
        {strip && (
          <div ref={stripBox} className={styles.strip}>
            {strip(stripOpen)}
          </div>
        )}
        <CatacombPlate candles={candles} />
        <CatacombLights />
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
        <CatacombFront />
        <header className={styles.top}>
          <div className={styles.slate}>
            <h1 className={styles.name}>Arch-Lich {MALAKOR_NAME}</h1>
            <p className={styles.from}>live from the Ninth Dark</p>
            <VoiceTally voiced={voiced} />
          </div>
          <OnAirLamp lit={onAir} />
          <div className={styles.controls}>
            {badge}
            {controls}
          </div>
        </header>
        <Captions caption={speaking ? caption : undefined} speaker={MALAKOR_NAME} dead={dead} audio={audio} />
        {sound === "blocked" && (
          <button type="button" className={styles.soundOn} onClick={soundOn}>
            Sound on
          </button>
        )}
      </section>
      <Chat
        chat={chat}
        self={MALAKOR_NAME}
        onPost={post}
        maxLength={MAX_CHAT_CHARS}
        answered={answered}
        velocity={lights.velocity}
        heat={dead ? 0 : lights.heat}
        {...(answeredNow === undefined ? {} : { answeredId: answeredNow })}
      />
      <audio ref={setAudio} preload="auto" />
    </div>
  );
}

export default AirPage;
