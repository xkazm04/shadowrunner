// Staged progress (creator requirement 3.2): one step per forge status, the current one legible
// and marked, with the elapsed time. Used in the FORGE NEW sheet and, large, over the stage.
import type { ForgeStatus } from "@sr/forge/wire";
import type { RunningStatus } from "./forgeReducer";
import styles from "./Forge.module.css";

export const STEPS: readonly { status: Exclude<ForgeStatus, "failed">; label: string }[] = [
  { status: "queued", label: "In the queue" },
  { status: "portrait", label: "Painting the portrait" },
  { status: "segmenting", label: "Finding the parts" },
  { status: "cutting", label: "Cutting the layers" },
  { status: "filling", label: "Filling behind the cuts" },
  { status: "done", label: "Rigged and alive" },
];

export const stepLabel = (status: RunningStatus): string => STEPS.find((s) => s.status === status)?.label ?? status;

/** "m:ss". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ForgeProgress({ status, elapsedMs }: { status: RunningStatus; elapsedMs: number }) {
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <div className={styles.progress}>
      <p className={styles.now} aria-live="polite">
        <span>{stepLabel(status)}…</span>
        <span className={styles.elapsed} aria-label={`Elapsed ${formatElapsed(elapsedMs)}`}>
          {formatElapsed(elapsedMs)}
        </span>
      </p>
      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li
            key={step.status}
            data-step={i < current ? "done" : i === current ? "now" : "next"}
            aria-current={i === current ? "step" : undefined}
          >
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
