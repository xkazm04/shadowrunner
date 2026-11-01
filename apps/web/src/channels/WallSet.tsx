// CH 4, one television on the wall of sets (costume 5.1, after `r1/characters-c.html` `.tv`): a
// cabinet in one of four junk-shop skins, the bezel, the tube, the brass plate with the hour and
// the name, two knobs and the power LED. What the tube shows depends on the set: a later hour's
// cast still on standby, the house character live (the page hands in the live tube), the vacant
// hour's static, or channel 9 taped over. Warming (hover, focus) is CSS; the page is told so it
// can throw the set's colour across the brick.
import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { ListedCharacter } from "./Listings";
import type { WallSet as WallSetData } from "./ListingsWall";
import styles from "./WallSet.module.css";
import tube from "./WallTube.module.css";

export interface WallSetProps {
  set: WallSetData<ListedCharacter>;
  pressed: boolean;
  /** The live set's tube (the lazy renderer); unused by the others. */
  liveTube?: ReactNode;
  /** The live set's still, under the renderer until it lands. */
  liveStill?: string;
  /** The live channel, for the tube's on-screen corner. */
  liveChannel: number;
  onChoose(set: WallSetData<ListedCharacter>): void;
  onWarm(el: HTMLElement, set: WallSetData<ListedCharacter>): void;
  onCool(): void;
}

const SKIN_CLASS = { wood: styles.wood, black: styles.black, cream: styles.cream, teal: styles.teal } as const;

const SNOW_W = 96;
const SNOW_H = 72;
const SNOW_MS = 60;

/** The vacant hour's live static: noise at ~16 frames a second; one still frame under reduced motion. */
function Snow(): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx === null || ctx === undefined || typeof ctx.createImageData !== "function") return undefined;
    const frame = ctx.createImageData(SNOW_W, SNOW_H);
    const draw = (): void => {
      const d = frame.data;
      for (let k = 0; k < d.length; k += 4) {
        const v = (Math.random() * 255) | 0;
        d[k] = v;
        d[k + 1] = v;
        d[k + 2] = v;
        d[k + 3] = 255;
      }
      ctx.putImageData(frame, 0, 0);
    };
    draw();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = window.setInterval(draw, SNOW_MS);
    return () => window.clearInterval(id);
  }, []);
  return <canvas ref={ref} className={tube.snow} width={SNOW_W} height={SNOW_H} aria-hidden="true" />;
}

function Tube({ set, liveTube, liveStill, liveChannel }: Pick<WallSetProps, "set" | "liveTube" | "liveStill" | "liveChannel">) {
  switch (set.kind) {
    case "live":
      return (
        <>
          {liveStill !== undefined && <img className={styles.face} src={liveStill} alt="" width={512} height={512} decoding="async" />}
          <span className={tube.rigBox}>{liveTube}</span>
          <span className={tube.osd}>{`CH ${liveChannel}`}</span>
          <span className={`${tube.osd} ${tube.osdRight}`}>{`${set.hour} · LIVE`}</span>
        </>
      );
    case "cast":
      return (
        <>
          {set.member?.portraitUrl !== undefined && (
            <img className={styles.face} src={set.member.portraitUrl} alt="" width={512} height={512} loading="lazy" decoding="async" />
          )}
        </>
      );
    case "vacant":
      return (
        <>
          <Snow />
          <span className={tube.msg}>
            <span>{set.plate}</span>
          </span>
        </>
      );
    case "sealed":
      return (
        <>
          <span className={tube.tape}>{set.plate}</span>
          <span className={`${tube.tape} ${tube.tapeTwo}`}>{set.name.toUpperCase()}</span>
        </>
      );
  }
}

export function WallSet({ set, pressed, liveTube, liveStill, liveChannel, onChoose, onWarm, onCool }: WallSetProps): ReactElement {
  const big = set.kind === "live";
  const style = { "--wall-c": `var(--sr-${set.accent})`, "--wall-bd": `${set.bootDelay}s` } as CSSProperties;
  return (
    <button
      type="button"
      className={[styles.tv, SKIN_CLASS[set.skin], big ? styles.big : "", styles[set.kind] ?? ""].filter(Boolean).join(" ")}
      style={style}
      aria-pressed={pressed}
      aria-label={set.label}
      data-set={set.key}
      data-kind={set.kind}
      onClick={() => onChoose(set)}
      onPointerEnter={(e) => onWarm(e.currentTarget, set)}
      onFocus={(e) => onWarm(e.currentTarget, set)}
      onPointerLeave={(e) => {
        if (document.activeElement !== e.currentTarget) onCool();
      }}
      onBlur={onCool}
    >
      {big && (
        <span className={tube.onair} aria-hidden="true">
          <span>●</span> ON AIR
        </span>
      )}
      <span className={styles.bezel}>
        <span className={styles.tube}>
          <span className={styles.screen}>
            <Tube set={set} liveTube={liveTube} liveStill={liveStill} liveChannel={liveChannel} />
          </span>
        </span>
      </span>
      <span className={styles.plate}>
        <span className={styles.who}>
          <span className={styles.hour}>{set.plate}</span>
          <span className={styles.name}>{set.name}</span>
        </span>
        <span className={styles.knobs} aria-hidden="true">
          <i />
          <i />
        </span>
      </span>
      <span className={styles.led} aria-hidden="true" />
    </button>
  );
}
