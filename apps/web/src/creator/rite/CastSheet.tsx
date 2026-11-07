// The casting sheet (forge-creator L2), on the glass after "Draw it": three draft portraits, each a
// living provisional rig (the face is the hero: each candidate's face fills its card), side by side,
// one at a time on a narrow screen. One pose switch works on all three, so they compare like for
// like: Rest (the live driver: breathing, blinks, the parts' own motion), Jaw (open) and Turn
// (the head turned, the parallax showing). Jaw and Turn are stills; Rest is still under reduced
// motion (the player's own twin). Under each: what was not found, said plainly. "Cast this one"
// hands that candidate to the forge; "None of these" re-rolls (the count left is shown); "Back to
// the brief" returns to the card.
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import type { CastCandidateView, CastView } from "@sr/forge/wire";
import { defaultLook, YAW_LIMIT_DEG, type Drive, type Rig } from "@sr/rig";
import { useEffect, useId, useMemo, useState } from "react";
import type { CastState } from "./castState";
import { sheetOf } from "./castState";
import styles from "./CastSheet.module.css";

export type CastPose = "rest" | "jaw" | "turn";

export const POSES: readonly { pose: CastPose; label: string }[] = [
  { pose: "rest", label: "Rest" },
  { pose: "jaw", label: "Jaw open" },
  { pose: "turn", label: "Head turned" },
];

/** The drive of a still pose; undefined for Rest (the live driver). */
export function poseDrive(pose: CastPose): Drive | undefined {
  if (pose === "jaw") return { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0.9, blink: 0, still: true };
  if (pose === "turn") return { t: 0, headYaw: YAW_LIMIT_DEG * 0.8, headPitch: 0, jawOpen: 0, blink: 0, still: true };
  return undefined;
}

/** The status line of a casting state. */
export function castLine(state: CastState): string {
  if (state.phase === "failed") return state.message;
  if (state.phase === "ready") return "Three drafts, cut provisionally. Cast one; only then are its fill, eyes and faces painted.";
  if (state.phase !== "casting") return "";
  const status = state.view?.status;
  if (status === undefined || status === "drafting") return "Drawing three drafts…";
  if (status === "segmenting") return "Finding each draft's planned parts…";
  return `Cutting the drafts: ${state.view?.candidates.filter((c) => c.state !== "drafting").length ?? 0} of ${state.view?.candidates.length ?? 0} done…`;
}

/** The candidate's layer images, decoded for the renderer; undefined until every one is (or on failure: the still stays). */
function useDecoded(rig: Rig | undefined, urls: Readonly<Record<string, string>> | undefined): RigAssets | undefined {
  const [decoded, setDecoded] = useState<{ rig: Rig; assets: RigAssets } | undefined>(undefined);
  useEffect(() => {
    if (rig === undefined || urls === undefined) return undefined;
    let live = true;
    const load = async (file: string): Promise<[string, HTMLImageElement]> => {
      const image = new Image();
      image.src = urls[file] ?? "";
      await image.decode();
      return [file, image];
    };
    Promise.all(rig.layers.map((l) => load(l.file))).then(
      (pairs) => live && setDecoded({ rig, assets: Object.fromEntries(pairs) }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rig, urls]);
  return decoded !== undefined && decoded.rig === rig ? decoded.assets : undefined;
}

function Preview({ candidate, pose, name }: { candidate: CastCandidateView; pose: CastPose; name: string }) {
  const look = useMemo(() => (candidate.rig === undefined ? undefined : defaultLook(candidate.rig)), [candidate.rig]);
  const assets = useDecoded(candidate.rig, candidate.assets);
  const drive = poseDrive(pose);
  if (candidate.rig !== undefined && assets !== undefined && look !== undefined) {
    return (
      <div className={styles.face} role="img" aria-label={`Draft ${candidate.index + 1} of ${name}, ${POSES.find((p) => p.pose === pose)?.label.toLowerCase() ?? pose}`}>
        <AvatarCanvas rig={candidate.rig} look={look} assets={assets} className={styles.canvas} seed={candidate.index + 1} {...(drive === undefined ? {} : { drive })} />
      </div>
    );
  }
  if (candidate.portraitUrl !== undefined) {
    return (
      <div className={styles.face}>
        <img className={styles.still} src={candidate.portraitUrl} alt={`Draft ${candidate.index + 1} of ${name}, a still portrait`} />
      </div>
    );
  }
  return <div className={styles.face} data-empty={candidate.state === "failed" ? "failed" : "drafting"} aria-hidden="true" />;
}

function Facts({ candidate }: { candidate: CastCandidateView }) {
  const lines: string[] = [];
  if (candidate.state === "drafting") lines.push(candidate.portraitUrl === undefined ? "Being drawn." : "Being cut.");
  if (candidate.note !== undefined) lines.push(candidate.note);
  if (candidate.state !== "uncut" && candidate.missing.length > 0) lines.push(`Not found: ${candidate.missing.map((n) => n.replaceAll("_", " ")).join(", ")}.`);
  if (candidate.empty.length > 0) lines.push(`Cut came out empty: ${candidate.empty.map((n) => n.replaceAll("_", " ")).join(", ")}.`);
  for (const w of candidate.warnings) lines.push(`${w.charAt(0).toUpperCase()}${w.slice(1)}.`);
  if (candidate.state === "cut" && lines.length === 0) lines.push("Every planned part was found.");
  return (
    <ul className={styles.facts}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export interface CastSheetProps {
  state: CastState;
  name: string;
  recorded: boolean;
  /** A cast is in flight (the forge job is starting). */
  busy: boolean;
  onCast: (index: number) => void;
  onReroll: () => void;
  onBack: () => void;
}

export function CastSheet({ state, name, recorded, busy, onCast, onReroll, onBack }: CastSheetProps) {
  const sheet: CastView | undefined = sheetOf(state);
  const [pose, setPose] = useState<CastPose>("rest");
  const [focus, setFocus] = useState(0);
  const poseName = useId();
  const casting = state.phase === "casting";
  const ready = state.phase === "ready";
  const candidates = sheet?.candidates ?? [];
  const shown = Math.min(focus, Math.max(0, candidates.length - 1));
  const left = sheet?.rerollsLeft ?? 0;

  return (
    <section className={styles.sheet} aria-label="Casting: three drafts" data-phase={state.phase}>
      <header className={styles.head}>
        <h2 className={styles.title}>Cast {name}</h2>
        <span className={styles.tag}>{recorded ? "RECORDED" : "provisional"}</span>
      </header>
      <p className={styles.line} role={state.phase === "failed" ? "alert" : "status"}>
        {castLine(state)}
      </p>
      <fieldset className={styles.poses} disabled={candidates.every((c) => c.rig === undefined)}>
        <legend className={styles.legend}>Preview</legend>
        {POSES.map((p) => (
          <label key={p.pose} className={styles.pose}>
            <input type="radio" name={poseName} value={p.pose} checked={pose === p.pose} onChange={() => setPose(p.pose)} />
            {p.label}
          </label>
        ))}
      </fieldset>
      <ol className={styles.cards}>
        {candidates.map((c) => (
          <li key={`${sheet?.batchId ?? ""}-${c.index}`} className={styles.card} data-state={c.state} data-shown={c.index === shown ? "" : undefined}>
            <Preview candidate={c} pose={pose} name={name} />
            <h3 className={styles.cardName}>Draft {String.fromCharCode(65 + c.index)}</h3>
            <Facts candidate={c} />
            <button type="button" className={styles.cast} disabled={!ready || busy || c.portraitUrl === undefined || c.state === "failed"} onClick={() => onCast(c.index)}>
              Cast this one
            </button>
          </li>
        ))}
      </ol>
      {candidates.length > 1 && (
        <div className={styles.stepper}>
          <button type="button" className={styles.key} onClick={() => setFocus((shown + candidates.length - 1) % candidates.length)}>
            ‹ Previous
          </button>
          <span>
            Draft {shown + 1} of {candidates.length}
          </span>
          <button type="button" className={styles.key} onClick={() => setFocus((shown + 1) % candidates.length)}>
            Next ›
          </button>
        </div>
      )}
      <div className={styles.foot}>
        <button type="button" className={styles.key} disabled={casting || busy || left <= 0} onClick={onReroll}>
          None of these <small>{left === 1 ? "1 re-roll left" : `${left} re-rolls left`}</small>
        </button>
        <button type="button" className={styles.key} disabled={busy} onClick={onBack}>
          Back to the brief
        </button>
      </div>
    </section>
  );
}
