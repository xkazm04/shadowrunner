// The on-air stage (voice-and-air 5.3; costume task 6, requirement 8): "Candles of the Catacomb".
// Malakor's face at centre of a symmetrical catacomb whose vanishing point sits behind his skull;
// the tunnel's far light is his backlight and swells with his real speech level; the ON AIR box
// hangs dead centre from the vault; captions are a centred lower third revealed word by word; the
// eight candles painted into the plate burn with chat velocity and flare for their chatter's post
// (useStageLights, candles.ts). Full screen with no shell header, so the page works as a browser
// source for a stream. The shell hands in the RECORDED badge, the theme toggle (the haunt toggle:
// a theme without haunt stills the candles) and the channel strip, which stays hidden for capture
// and opens on top-edge hover, focus, or the C key; Esc closes it before Esc may leave the page.
// character-control 6: the face is the character "Put on air" recorded (onAir.ts), with its saved
// look; Malakor with his default look when none is recorded or it is gone. The reply's emotion
// still sets look.emotion. The persona, the voice and the recorded show are the character's own (cast.ts).
// C4: a forged character with a sheet and no recorded show plays its sheet's script; on replay the
// script runs in the browser (no engine or voice request) and the slate says SCRIPTED.
// tiger L1: a line that says a part's cue word fires that part's signature act (useActCue.ts); a
// recorded cast character's acts are compiled from its recorded brief at load time (castActs.ts).
// perfection-pass 4: the face reads the stage's one analyser tap (`level`) and, while a line plays,
// the line's mouth track (mouthTrack.ts); a rig without a drawn or warp mouth keeps the level jaw.
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import { castSlug, MAX_CHAT_CHARS } from "@sr/engine";
import { defaultLook, type Look, type Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Plane } from "../app/plane";
import styles from "./air.module.css";
import { stageActs, withActs, type StageAct } from "./acts";
import { Captions } from "./Captions";
import { castActs } from "./castActs";
import { CatacombFront, CatacombLights, CatacombPlate } from "./Catacomb";
import { Chat } from "./Chat";
import { castBank, castFor } from "./cast";
import { loadRigAssets, MALAKOR_NAME, malakorRig } from "./malakor";
import { OnAirLamp, VoiceTally } from "./OnAirLamp";
import { useOnAir, type OnAirState } from "./onAir";
import { localScript } from "./sheetShow";
import { useClipMouth } from "./mouthTrack";
import { useLoudness } from "./useLoudness";
import { useActCue } from "./useActCue";
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

type Loaded = { rig: Rig; assets: RigAssets; look?: Look; name?: string } | "loading" | "failed";

const NO_ACTS: readonly StageAct[] = [];

/** The on-air character with its look (and its cast acts, when it is a recorded cast character), else Malakor (loaded only when he is the one on air). */
function useFace(onAir: OnAirState): Loaded {
  const malakor = useMalakor(onAir === "none");
  const rig = typeof onAir === "object" ? onAir.rig : undefined;
  const id = typeof onAir === "object" ? onAir.id : undefined;
  const acted = useMemo(() => (rig === undefined || id === undefined ? undefined : withActs(rig, castActs(castSlug(id)))), [rig, id]);
  if (onAir === "looking") return "loading";
  return onAir === "none" || acted === undefined ? malakor : { rig: acted, assets: onAir.assets, look: onAir.look, name: onAir.name };
}

function useMalakor(wanted: boolean): Loaded {
  const [loaded, setLoaded] = useState<Loaded>("loading");
  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    const rig = malakorRig();
    loadRigAssets(rig)
      .then((assets) => alive && setLoaded({ rig, assets }))
      .catch(() => alive && setLoaded("failed"));
    return () => {
      alive = false;
    };
  }, [wanted]);
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
  const who = useOnAir();
  const loaded = useFace(who);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const loudness = useLoudness(audio);
  // The line's mouth track (perfection-pass task 4): shapes for a drawn or warp mouth while it speaks.
  const clipMouth = useClipMouth(audio);
  const speaker = typeof who === "object" ? who : undefined;
  const { id, name, voice, sheet } = speaker ?? {};
  const faceRig = typeof loaded === "object" ? loaded.rig : undefined;
  const acts = useMemo(() => (faceRig === undefined ? NO_ACTS : stageActs(faceRig)), [faceRig]);
  const cast = useMemo(
    () => castFor(id === undefined || name === undefined || voice === undefined ? undefined : { id, name, voice, ...(sheet === undefined ? {} : { sheet }), ...(acts.length === 0 ? {} : { acts }) }),
    [id, name, voice, sheet, acts],
  );
  // The sheet's script on replay: answered in the browser, so no paid endpoint is ever asked.
  const scripted = cast.scripted === true && plane === "replay";
  const local = useMemo(() => (scripted ? localScript(cast.show, cast.persona.voice, castBank()) : undefined), [scripted, cast]);
  const { snapshot, now, post, soundOn } = useShow({
    show: cast.show,
    persona: cast.persona,
    self: cast.self,
    // The show waits for the on-air lookup, so Malakor never starts talking in someone else's place.
    audio: who === "looking" ? null : audio,
    ensureRunning: loudness.ensureRunning,
    ...(local === undefined ? {} : { local }),
  });
  const { status, caption, chat, sound } = snapshot;
  const speaking = status === "speaking";
  const voiced = useVoiced(loudness.jawOpen, speaking && caption?.voiced === true);
  const onAir = status === "on_air" || status === "speaking";
  const dead = status === "dead_line";

  const root = useRef<HTMLDivElement>(null);
  const candles = useRef<(HTMLElement | null)[]>([]);
  const lights = useStageLights({ root, candles, chat, self: cast.self, now, jawOpen: loudness.jawOpen, speaking, dead });

  const stripBox = useRef<HTMLDivElement>(null);
  const stripOpen = useStripKeys(stripBox);

  // Every message he has answered keeps its mark for as long as it is on screen.
  const answeredNow = speaking ? caption?.answered?.id : undefined;
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (answeredNow !== undefined) setAnswered((prev) => (prev.has(answeredNow) ? prev : new Set(prev).add(answeredNow)));
  }, [answeredNow]);

  const emotion = speaking && caption ? caption.reply.emotion : "neutral";
  const look = useMemo<Look | undefined>(() => {
    if (typeof loaded !== "object") return undefined;
    const base = loaded.look ?? defaultLook(loaded.rig);
    return { ...base, hidden: [...new Set([...base.hidden, ...STAGE_HIDDEN])].sort(), emotion };
  }, [loaded, emotion]);
  const title = typeof loaded === "object" && loaded.name !== undefined ? loaded.name : `Arch-Lich ${MALAKOR_NAME}`;
  const gesture = speaking ? caption?.reply.gesture : undefined;
  const actFire = useActCue(speaking ? caption : undefined, audio, acts);

  return (
    <div ref={root} className={styles.stage} data-page="air" data-state={status} data-plane={plane} data-sound={sound}>
      <section className={styles.set} aria-label={`${cast.self} on air`}>
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
              // LINE DEAD: only the eyes stay lit (the renderer's eyes-only dim; instant under reduced motion).
              dim={dead ? 1 : 0}
              level={loudness.level}
              {...(speaking && clipMouth !== undefined ? { mouth: clipMouth } : {})}
              {...(gesture === undefined ? {} : { gesture })}
              {...(actFire === undefined ? {} : { act: actFire })}
            />
          ) : (
            <p className={styles.faceNote}>{loaded === "failed" ? "The face did not load." : "Raising the dead..."}</p>
          )}
        </div>
        <CatacombFront />
        <header className={styles.top}>
          <div className={styles.slate}>
            <h1 className={styles.name}>{title}</h1>
            <p className={styles.from}>live from the Ninth Dark</p>
            {scripted && (
              <p className={styles.scripted} data-script="sheet">
                SCRIPTED <small>its own lines</small>
              </p>
            )}
            <VoiceTally voiced={voiced} />
          </div>
          <OnAirLamp lit={onAir} />
          <div className={styles.controls}>
            {badge}
            {controls}
          </div>
        </header>
        <Captions caption={speaking ? caption : undefined} speaker={cast.self} dead={dead} audio={audio} />
        {sound === "blocked" && (
          <button type="button" className={styles.soundOn} onClick={soundOn}>
            Sound on
          </button>
        )}
      </section>
      <Chat
        chat={chat}
        self={cast.self}
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
