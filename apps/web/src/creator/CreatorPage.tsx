// CH 3 · Forge: the creator page (spec creator). It owns what outlives one character: the library,
// the forge job (it keeps running across tab and character switches), the forge draft, the open
// tab and the reveal of a freshly forged character. Workbench renders the regions.
import type { Rig } from "@sr/rig";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlane, type Plane } from "../app/plane";
import { createHttpForgeClient, type ForgeClient } from "./forgeClient";
import { createReplayForgeClient, failOf } from "./forgeClient.replay";
import { ForgePanel, type ForgeDraft } from "./forge/ForgePanel";
import { ForgeProgress, stepLabel } from "./forge/ForgeProgress";
import { recordOf } from "./forge/keep";
import { useForgeJob } from "./forge/useForgeJob";
import { Gallery } from "./gallery/Gallery";
import type { GalleryEntry } from "./gallery/entries";
import { Library } from "./library/Library";
import { useLibrary, wantedCharacter } from "./library/useLibrary";
import { ChannelActions } from "./ChannelActions";
import { Stage } from "./Stage";
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
  // `/creator?character=<slug>` (CH 4's "Open in the Forge") puts that character on the stage.
  const [want] = useState(() => (typeof window === "undefined" ? undefined : wantedCharacter(window.location.search)));
  const library = useLibrary(want === undefined ? {} : { want });
  // The link has done its work once the library has read it: drop it from the address, so a later
  // visit (or the router carrying the query to another channel) does not pull that character back.
  useEffect(() => {
    if (want === undefined || library.status === "loading") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("character");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [want, library.status]);
  const plane = usePlane();
  const client = useMemo(() => planeClient(plane, typeof window === "undefined" ? "" : window.location.search), [plane]);
  const job = useForgeJob(client);
  const [draft, setDraft] = useState<ForgeDraft>({ prompt: "" });
  const [tab, setTab] = useState<Tab>("looks");
  const [revealed, setRevealed] = useState<{ id: string; name: string; jobId: string } | undefined>(undefined);
  const [keepError, setKeepError] = useState<string | undefined>(undefined);
  const [galleryOpen, setGalleryOpen] = useState(false);

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
      recorded={plane === "replay"}
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

  const inLibrary = new Set(library.entries.flatMap((e) => (e.kind === "ok" ? [e.record.id] : [])));
  const adopt = async (entry: GalleryEntry): Promise<void> => {
    await add(await entry.load());
    setGalleryOpen(false);
  };
  const show = (id: string): void => {
    setGalleryOpen(false);
    library.select(id);
  };
  const gallery = <Gallery inLibrary={inLibrary} onAdopt={adopt} onShow={show} onClose={() => setGalleryOpen(false)} />;
  const onTab = (next: Tab): void => {
    setGalleryOpen(false);
    setTab(next);
  };

  const active = library.active;
  const shelf = (
    <Library
      entries={library.entries}
      {...(active === undefined ? {} : { activeId: active.id })}
      persistent={library.persistent}
      status={library.status}
      onSelect={(id) => {
        setGalleryOpen(false);
        library.select(id);
      }}
      onRemove={library.remove}
      onOpenGallery={() => setGalleryOpen(true)}
    />
  );

  // Loading, or nothing to put on the stage (an empty or unreadable library): the regions stay,
  // each with its designed state, and the gallery is one press away.
  if (active === undefined) {
    const loading = library.status === "loading";
    return (
      <div className={styles.creator} data-page="creator" data-state={loading ? "loading" : "empty"}>
        <div className={styles.stageRegion}>
          <Stage motion={loading ? "Opening the library" : "Empty stage"}>
            <p className={styles.state}>{loading ? "Opening the library…" : "No character on the stage yet. Adopt one from the gallery, or forge one."}</p>
          </Stage>
        </div>
        <div className={styles.controlsRegion}>
          <div className={styles.panelWrap}>
            <div className={styles.panel}>
              <div className={styles.sheet}>{loading ? <p className={styles.sheetNote}>Opening the library…</p> : gallery}</div>
              <ChannelActions />
            </div>
          </div>
          {shelf}
        </div>
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
      onTab={onTab}
      forge={forge}
      {...(galleryOpen ? { sheet: gallery } : {})}
      below={shelf}
      {...(stageOverlay === undefined ? {} : { stageOverlay })}
      {...(running === undefined ? {} : { motion: `Forging · ${stepLabel(running.status)}` })}
      {...(reveal === undefined ? {} : { revealKey: reveal.jobId })}
      {...(isRecorded(active.rig) ? { badge: <span className={styles.recorded}>RECORDED</span> } : {})}
    />
  );
}
