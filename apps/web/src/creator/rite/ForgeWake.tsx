// The rite's last two marks (costume 3.2): Forge lists the job's stages with their recorded holds
// (and how long the live run that was recorded took), the current one lit; a failure that is not
// about the description lands here with its copy and a retry. Wake hands the new face to the Forge
// (/creator, with it selected) or puts it on air.
import type { ForgeErrorCode } from "@sr/forge/wire";
import { PAGES } from "../../app/pages";
import { handleLinkClick } from "../../app/router";
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
  done: "Rigged and alive",
};

export interface ForgeMarkProps {
  step?: RunStep;
  steps?: readonly ReplayStep[];
  live?: Partial<Record<RunStep, number>>;
  failure?: { code: ForgeErrorCode; message: string };
  recorded: boolean;
  onRetry?: () => void;
  onEdit: () => void;
}

export function ForgeMark({ step, steps, live, failure, recorded, onRetry, onEdit }: ForgeMarkProps) {
  const at = step === undefined ? -1 : RUN_STEPS.indexOf(step);
  const total = steps?.reduce((sum, s) => sum + s.holdMs, 0);
  const liveTotal = live === undefined ? undefined : Object.values(live).reduce((sum, ms) => sum + ms, 0);
  return (
    <>
      <span className={marks.lbl}>
        STAGE <small>{steps === undefined ? "live" : "hold / live"}</small>
      </span>
      <ol className={styles.stages}>
        {RUN_STEPS.map((s, j) => {
          const hold = steps?.find((x) => x.status === s)?.holdMs;
          const ran = live?.[s];
          return (
            <li key={s} data-state={j < at || step === "done" ? "done" : j === at ? "now" : "next"} aria-current={j === at && step !== "done" ? "step" : undefined}>
              <b>{STEP_VERB[s]}</b>
              <span>
                {hold === undefined || hold === 0 ? "" : secText(hold)}
                {ran === undefined ? "" : ` / ${secText(ran)}`}
              </span>
            </li>
          );
        })}
      </ol>
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
}

export function WakeMark({ name, layers, handoff, keepError }: WakeMarkProps) {
  if (keepError !== undefined) return <p className={marks.note}>{keepError}</p>;
  if (name === undefined || handoff === undefined) return <p className={marks.note}>The face wakes here when the forge is done.</p>;
  return (
    <div className={styles.wake}>
      <p>
        {name} is rigged: {layers} layers, lit and breathing. Its lights are pinned to the face now, as on the Forge page.
      </p>
      <a className={`${styles.btn} ${styles.amber}`} href={handoff} onClick={(event) => handleLinkClick(event, handoff)} data-handoff="">
        Open in Anatomy Under Glass <kbd>CH {forge?.channel}</kbd>
      </a>
      {onAir !== undefined && (
        <a className={`${styles.btn} ${styles.red}`} href={onAir.path} onClick={(event) => handleLinkClick(event, onAir.path)}>
          Put on air <kbd>CH {onAir.channel}</kbd>
        </a>
      )}
    </div>
  );
}
