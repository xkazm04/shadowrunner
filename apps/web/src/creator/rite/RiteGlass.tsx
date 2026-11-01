// The glass of the rite (costume 3.2, `r2/creator-a.html` `Glass`): one surface that shows every
// state of the forge job. Empty glass and static while the job waits; the portrait developing out
// of the static once the forge sends it; the parts boxed as they are found and lifted off as they
// are cut (from the recorded job's layer boxes, on replay); a light sweeping the plate while it is
// filled; then the woken face itself, through <AvatarCanvas> (the Forge's own Glass).
// The tape under it is the job's steps, each cell as wide as its recorded hold.
import type { Layer, Rig } from "@sr/rig";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { ReplayStep } from "../replayJobs";
import { boxOf } from "../glass/pins";
import glass from "../glass/Glass.module.css";
import { RUN_STEPS, secText, type RunStep, type SlotState } from "./riteClock";
import styles from "./Rite.module.css";

const reduced = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** TV static on a small canvas, redrawn every third frame (once under reduced motion). */
function Static({ on }: { on: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!on || ctx === null || ctx === undefined) return undefined;
    const img = ctx.createImageData(128, 128);
    const draw = (): void => {
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 120;
        img.data[i] = v * 1.1;
        img.data[i + 1] = v * 0.85;
        img.data[i + 2] = v * 0.6;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    draw();
    if (reduced()) return undefined;
    let raf = 0;
    let n = 0;
    const tick = (): void => {
      n += 1;
      if (n % 3 === 0) draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return <canvas ref={canvas} className={styles.static} width={128} height={128} data-on={on ? "" : undefined} aria-hidden="true" />;
}

export interface DevelopingProps {
  /** undefined: no job yet. */
  step?: RunStep;
  /** The rig the boxes come from (the recorded job's), when known. */
  rig?: Pick<Rig, "width" | "height">;
  parts: readonly Layer[];
  slots: Readonly<Record<string, SlotState>>;
  portraitUrl?: string;
  name?: string;
  chip: ReactNode;
  failed: boolean;
}

/** The glass before the face wakes. */
export function Developing({ step, rig, parts, slots, portraitUrl, name, chip, failed }: DevelopingProps) {
  const rank = step === undefined ? -1 : RUN_STEPS.indexOf(step);
  const boxing = step === "segmenting" || step === "cutting";
  return (
    <div className={glass.glass}>
      <div className={glass.dome} data-step={step ?? "idle"}>
        <Static on={!failed && rank <= RUN_STEPS.indexOf("portrait")} />
        {portraitUrl !== undefined && (
          <img key={portraitUrl} className={styles.portrait} src={portraitUrl} alt={name === undefined ? "The new portrait" : `Painted portrait of ${name}`} data-step={step} />
        )}
        {(step === "portrait" || step === "segmenting") && <span className={styles.scan} data-step={step} aria-hidden="true" />}
        {boxing &&
          rig !== undefined &&
          parts.map((part) => {
            const state = slots[part.name];
            if (state === "waiting") return null;
            const b = boxOf(rig, part.bbox);
            return (
              <span
                key={part.name}
                className={styles.box}
                data-cut={state === "cut" ? "" : undefined}
                data-top={b.top < 8 ? "" : undefined}
                style={{ insetInlineStart: `${b.left}%`, insetBlockStart: `${b.top}%`, inlineSize: `${b.width}%`, blockSize: `${b.height}%` }}
                aria-hidden="true"
              >
                <span className={styles.boxTag}>
                  {part.name} <small>{`${Math.round(part.bbox[2])}×${Math.round(part.bbox[3])}`}</small>
                </span>
              </span>
            );
          })}
        {step === "filling" && <span className={styles.fill} aria-hidden="true" />}
        {step === undefined && (
          <p className={styles.wait}>
            The glass is empty
            <small>describe a character to begin</small>
          </p>
        )}
      </div>
      <span className={glass.sheen} aria-hidden="true" />
      <span className={glass.chip}>{chip}</span>
    </div>
  );
}

export interface TapeProps {
  step?: RunStep;
  p: number;
  steps?: readonly ReplayStep[];
  live?: Partial<Record<RunStep, number>>;
  /** On the replay plane, before the recording is known. */
  recorded?: boolean;
}

const LABEL: Readonly<Record<RunStep, string>> = {
  queued: "Queued",
  portrait: "Portrait",
  segmenting: "Segmenting",
  cutting: "Cutting",
  filling: "Filling",
  done: "Done",
};

/** The pipeline as a recorded tape: one cell per step, sized by its hold, filling as it runs. */
export function Tape({ step, p, steps, live, recorded = false }: TapeProps) {
  const at = step === undefined ? -1 : RUN_STEPS.indexOf(step);
  return (
    <ol className={styles.tape} aria-label="The forge job">
      {RUN_STEPS.slice(0, 5).map((s, j) => {
        const hold = steps?.find((x) => x.status === s)?.holdMs;
        const ran = live?.[s];
        const state = j < at ? "done" : j === at ? "now" : "next";
        return (
          <li
            key={s}
            className={styles.cell}
            data-state={state}
            aria-current={state === "now" ? "step" : undefined}
            style={{ flexGrow: hold ?? 1, "--f": `${state === "done" ? 100 : state === "now" ? Math.round(p * 100) : 0}%` } as CSSProperties}
          >
            <b>{LABEL[s]}</b>
            <small>{hold === undefined ? (recorded ? "recorded hold" : "live") : `${secText(hold)} hold`}</small>
            <small>{ran !== undefined ? `live ${secText(ran)}` : s === "queued" ? "no model" : steps === undefined ? (recorded ? "a recording" : "real job") : "live —"}</small>
          </li>
        );
      })}
    </ol>
  );
}
