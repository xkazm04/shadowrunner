// CH 3 · Forge: the creator page (spec creator). It owns what outlives one character: the library,
// the forge job (it keeps running across tab and character switches), the forge draft, the open
// tab and the reveal of a freshly forged character. Workbench renders the regions.
import type { Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlane, type Plane } from "../app/plane";
import { createHttpForgeClient, type ForgeClient } from "./forgeClient";
import { createReplayForgeClient, failOf } from "./forgeClient.replay";
import { ForgePanel, type ForgeDraft } from "./forge/ForgePanel";
import { ForgeProgress } from "./forge/ForgeProgress";
import { recordOf } from "./forge/keep";
import { useForgeJob } from "./forge/useForgeJob";
import { useLibrary } from "./library/useLibrary";
import { Workbench, type Tab } from "./Workbench";
import styles from "./CreatorPage.module.css";

/**
 * The forge client for this plane. Replay forges in the browser (`?forge=fail:<code>` seeds a
 * failure); live goes to /api/forge. A job id minted by the replay client is always polled by it,
 * so a job started before health answered still finishes after the plane resolves to live.
 */
export function planeClient(plane: Plane, search: string): ForgeClient {
  const fail = failOf(search);
  const replay = createReplayForgeClient(fail === undefined ? {} : { fail });
  if (plane === "replay") return replay;
  const http = createHttpForgeClient();
  return { start: http.start, poll: (jobId) => (jobId.startsWith("replay_") ? replay.poll(jobId) : http.poll(jobId)) };
}

/** A character from the replay plane (a recorded forge or the gallery): labelled RECORDED. */
export const isRecorded = (rig: Rig): boolean => rig.source === "replay" || rig.id.startsWith("replay-");

export function CreatorPage() {
  const library = useLibrary();
  const plane = usePlane();
  const client = useMemo(() => planeClient(plane, typeof window === "undefined" ? "" : window.location.search), [plane]);
  const job = useForgeJob(client);
  const [draft, setDraft] = useState<ForgeDraft>({ prompt: "" });
  const [tab, setTab] = useState<Tab>("looks");
  const [revealed, setRevealed] = useState<{ id: string; name: string; jobId: string } | undefined>(undefined);
  const [keepError, setKeepError] = useState<string | undefined>(undefined);
  const [, setGalleryOpen] = useState(false);

  // A finished forge goes into the library once, then onto the stage with the reveal.
  const kept = useRef<string | undefined>(undefined);
  const add = library.add;
  const state = job.state;
  useEffect(() => {
    if (state.phase !== "done" || kept.current === state.jobId) return;
    kept.current = state.jobId;
    setKeepError(undefined);
    recordOf(state.rig, state.assets)
      .then(async (record) => {
        await add(record);
        setRevealed({ id: record.id, name: record.rig.name, jobId: state.jobId });
      })
      .catch(() => setKeepError("The new character's images could not be kept. Forge again."));
  }, [state, add]);

  const forge = (
    <ForgePanel
      job={job}
      draft={draft}
      onDraft={setDraft}
      onOpenGallery={() => setGalleryOpen(true)}
      doneNote={
        keepError ?? (revealed === undefined ? "Keeping the new character…" : `Revealed: ${revealed.name}. It is in your library; dress it in LOOKS.`)
      }
    />
  );

  const running = job.state.phase === "running" ? job.state : undefined;
  const stageOverlay =
    running === undefined ? undefined : (
      <div className={styles.forging}>
        {running.portraitUrl !== undefined && <img className={styles.portrait} src={running.portraitUrl} alt="The new portrait, before it is cut" />}
        <div className={styles.forgingCard}>
          <ForgeProgress status={running.status} elapsedMs={job.elapsedMs} />
        </div>
      </div>
    );

  const active = library.active;
  if (active === undefined) {
    return (
      <div className={styles.creator} data-page="creator">
        <p className={styles.state}>{library.status === "loading" ? "Opening the library…" : "No character to show."}</p>
      </div>
    );
  }
  const reveal = revealed?.id === active.id ? revealed : undefined;
  return (
    <Workbench
      key={`${active.id}@${active.createdAt}`}
      record={active}
      library={library}
      tab={tab}
      onTab={setTab}
      forge={forge}
      {...(stageOverlay === undefined ? {} : { stageOverlay })}
      {...(reveal === undefined ? {} : { revealKey: reveal.jobId })}
      {...(isRecorded(active.rig) ? { badge: <span className={styles.recorded}>RECORDED</span> } : {})}
    />
  );
}
