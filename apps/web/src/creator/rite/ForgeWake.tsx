// The rite's last two marks (costume 3.2): Forge lists the job's stages with their recorded holds
// (and how long the live run that was recorded took), the current one lit; a failure that is not
// about the description lands here with its copy and a retry. Wake hands the new face to the Forge
// (/creator, with it selected) or puts it on air.
import type { ForgeErrorCode, JobView } from "@sr/forge/wire";
import { EXPRESSION_FAMILIES, type ExpressionFamily } from "@sr/rig";
import { PAGES } from "../../app/pages";
import { handleLinkClick } from "../../app/router";
import { writeOnAir } from "../../air/onAir";
import type { ReplayStep } from "../replayJobs";
import { RUN_STEPS, secText, type RunStep } from "./riteClock";
import { FAILURE_COPY } from "./request";
import marks from "./Marks.module.css";
import styles from "./ForgeWake.module.css";

export const STEP_VERB: Readonly<Record<RunStep, string>> = {
  queued: "In the queue",
  portrait: "Painting the portrait",
  segmenting: "Finding the parts",
  cutting: "Cutting the layers",
  filling: "Filling behind the cuts",
  expressing: "Drawing the expressions",
  done: "Rigged and alive",
};

export type Expressions = NonNullable<JobView["expressions"]>;

/** The rite's expression progress (character-control 5.4): families answered so far, of six. */
export const expressionsProgress = (e: Expressions): string => `Expressions ${Object.keys(e).length} / ${EXPRESSION_FAMILIES.length}`;

/** forge-creator C1: after Wake, while the faces still paint in: families answered so far, of six. */
export const facesPainting = (e: Expressions): string => `Faces ${Object.keys(e).length} / ${EXPRESSION_FAMILIES.length} painting`;

/** The families that came to anything but "ok": they ship procedural only. */
export const proceduralFamilies = (e: Expressions): ExpressionFamily[] => EXPRESSION_FAMILIES.filter((f) => e[f] !== "ok");

/** While expressing, the count; once done, every family that is procedural. */
export function ExpressionsNote({ expressions, done }: { expressions: Expressions; done: boolean }) {
  if (!done) {
    return (
      <p className={marks.note} role="status" data-expressions="">
        {expressionsProgress(expressions)}
      </p>
    );
  }
  const procedural = proceduralFamilies(expressions);
  if (procedural.length === 0) return null;
  return (
    <p className={marks.note} data-procedural="">
      {procedural.map((f) => `${f} · procedural`).join(", ")}
    </p>
  );
}

export interface ForgeMarkProps {
  step?: RunStep;
  steps?: readonly ReplayStep[];
  live?: Partial<Record<RunStep, number>>;
  failure?: { code: ForgeErrorCode; message: string };
  recorded: boolean;
  /** A live brief job whose parts could not be found (`JobView.decomposition: "fallback"`). */
  fallback?: boolean;
  /** What each expression family came to so far (live jobs from "expressing" on). */
  expressions?: Expressions;
  onRetry?: () => void;
  onEdit: () => void;
}

/** The honest notice for a brief job cut without its own parts (cast-forge task 12). */
export const FALLBACK_NOTICE = "The brief's own parts could not be found in this portrait, so it was cut as the standard ten parts.";

function FallbackNotice() {
  return (
    <p className={marks.note} role="status" data-decomposition="fallback">
      {FALLBACK_NOTICE}
    </p>
  );
}

export function ForgeMark({ step, steps, live, failure, recorded, fallback = false, expressions, onRetry, onEdit }: ForgeMarkProps) {
  // The expressions stage is listed only for a job that runs it (a recorded job has none).
  const shown = RUN_STEPS.filter((s) => s !== "expressing" || step === "expressing" || expressions !== undefined);
  const at = step === undefined ? -1 : shown.indexOf(step);
  const total = steps?.reduce((sum, s) => sum + s.holdMs, 0);
  const liveTotal = live === undefined ? undefined : Object.values(live).reduce((sum, ms) => sum + ms, 0);
  return (
    <>
      <span className={marks.lbl}>
        STAGE <small>{steps === undefined ? "live" : "hold / live"}</small>
      </span>
      <ol className={styles.stages}>
        {shown.map((s, j) => {
          const hold = steps?.find((x) => x.status === s)?.holdMs;
          const ran = live?.[s];
          return (
            <li key={s} data-state={j < at || step === "done" ? "done" : j === at ? "now" : "next"} aria-current={j === at && step !== "done" ? "step" : undefined}>
              <b>{STEP_VERB[s]}</b>
              <span>
                {hold === undefined || hold === 0 ? "" : secText(hold)}
                {ran === undefined ? "" : ` / ${secText(ran)}`}
                {s === "expressing" && expressions !== undefined ? expressionsProgress(expressions) : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {fallback && <FallbackNotice />}
      {expressions !== undefined && <ExpressionsNote expressions={expressions} done={step === "done"} />}
      {failure !== undefined && (
        <div className={marks.refuse} role="alert" data-failure={failure.code}>
          <b>{FAILURE_COPY[failure.code].title}</b>
          {FAILURE_COPY[failure.code].body}
          <span className={marks.why}>
            {failure.code} · {failure.message}
          </span>
          <span className={marks.failKeys}>
            {failure.code === "upstream" && onRetry !== undefined && (
              <button type="button" className={marks.next} onClick={onRetry}>
                Try again
              </button>
            )}
            <button type="button" className={marks.next} onClick={onEdit}>
              Edit and send again
            </button>
          </span>
        </div>
      )}
      <p className={marks.note}>
        {recorded && total !== undefined ? (
          <>
            Replay plane: holds from <b>job.json</b>.{liveTotal === undefined ? "" : ` The live run took ${secText(liveTotal)};`} the tape plays it in{" "}
            <b>{secText(total)}</b>.
          </>
        ) : (
          "Live plane: a real forge job, asked for its state every 1.5 s."
        )}
      </p>
    </>
  );
}

const forge = PAGES.find((p) => p.id === "creator");
const onAir = PAGES.find((p) => p.id === "landing");

export interface WakeMarkProps {
  name?: string;
  layers?: number;
  /** /creator with the new face selected. */
  handoff?: string;
  keepError?: string;
  /** As ForgeMark's: the brief's parts were not found, the face was cut as the standard ten. */
  fallback?: boolean;
  /** The kept record's library id: "Put on air" records it (`sr.onAir`). */
  id?: string;
  /** What each expression family came to (live jobs). */
  expressions?: Expressions;
  /** C1: the face is awake and kept while the forge still paints its faces. */
  painting?: boolean;
}

export function WakeMark({ name, layers, handoff, keepError, fallback = false, id, expressions, painting = false }: WakeMarkProps) {
  if (keepError !== undefined) return <p className={marks.note}>{keepError}</p>;
  if (name === undefined || handoff === undefined) return <p className={marks.note}>The face wakes here when the forge is done.</p>;
  return (
    <div className={styles.wake}>
      <p>
        {name} is rigged: {layers} layers, lit and breathing. Its lights are pinned to the face now, as on the Forge page.
      </p>
      {fallback && <FallbackNotice />}
      {painting ? (
        <p className={marks.note} role="status" data-painting="">
          {facesPainting(expressions ?? {})}. It is yours already: tune it while they arrive.
        </p>
      ) : (
        expressions !== undefined && <ExpressionsNote expressions={expressions} done />
      )}
      <a className={`${styles.btn} ${styles.amber}`} href={handoff} onClick={(event) => handleLinkClick(event, handoff)} data-handoff="">
        Open in Anatomy Under Glass <kbd>CH {forge?.channel}</kbd>
      </a>
      {onAir !== undefined && (
        <a
          className={`${styles.btn} ${styles.red}`}
          href={onAir.path}
          data-on-air=""
          onClick={(event) => {
            if (id !== undefined) writeOnAir(id);
            handleLinkClick(event, onAir.path);
          }}
        >
          Put on air <kbd>CH {onAir.channel}</kbd>
        </a>
      )}
    </div>
  );
}
