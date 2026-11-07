// Forge new, /creator/new (costume 3.2, `r2/creator-a.html` "The Rite in Four Marks"): the Forge's
// rail and glass, with the right column turned into a four-mark rite. Describe (words, examples or
// a drawing; a real face is refused with the API's refused_likeness copy), Bind (archetype, voice,
// palette), Forge (the job, driven by the forge client: on replay a recorded job on its recorded
// holds, on live a real job) and Wake (the face lit and talking, then handed to /creator with it
// selected). The empty layer slots fill as the job's statuses arrive.
// cast-forge 4.3, the handshake: words are first briefed (BriefCard in mark I); only the approved
// brief is drawn (`mode: "brief"`). A drawing still goes straight to Bind and Forge.
// forge-creator C1: the face is kept and wakes as soon as the job is awake (its eyes settled, the
// rig final, useKept.ts); the rite then stands at Wake while the six faces paint in.
import { VOICES } from "@sr/engine";
import { parseBrief } from "@sr/forge/brief";
import type { CharacterBrief, ForgeErrorCode, ForgeRequest } from "@sr/forge/wire";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePlane } from "../../app/plane";
import { handleLinkClick } from "../../app/router";
import { briefClientFor, type BriefClient } from "../briefClient";
import type { ForgeClient } from "../forgeClient";
import { parseReplayJobId } from "../forgeClient.replay";
import { useForgeJob } from "../forge/useForgeJob";
import { Glass } from "../glass/Glass";
import { useGesturePulse } from "../glass/gestures";
import { useBlobUrls } from "../glass/LayerRail";
import { useTyped } from "../glass/SignalCards";
import { useLibrary, type UseLibraryOptions } from "../library/useLibrary";
import { loadReplayJobs, type ReplayJob } from "../replayJobs";
import { useSpeaker } from "../useSpeaker";
import anatomy from "../glass/Anatomy.module.css";
import signal from "../glass/Signal.module.css";
import keys from "./ForgeWake.module.css";
import { Handshake } from "./BriefCard";
import { BindMark, Describe, Marks } from "./Marks";
import { expressionsProgress, ForgeMark, STEP_VERB, WakeMark } from "./ForgeWake";
import { planeClient, withSeededStart } from "./planeClient";
import { ARCHETYPES, DESCRIBE_CODES, PALETTES, requestOf, type Bind, type ForgeDraft } from "./request";
import { clockText, markOf, progressIn, RUN_STEPS, secText, slotsAt, startOf, type Mark, type RunStep } from "./riteClock";
import { Developing, Tape } from "./RiteGlass";
import { RiteRail } from "./RiteRail";
import { useBrief } from "./useBrief";
import { useKept } from "./useKept";
import styles from "./Rite.module.css";

export interface RitePageProps {
  /** Default: the client for the plane. */
  client?: ForgeClient;
  /** Default: the brief client for the plane. */
  briefer?: BriefClient;
  /** Default: the committed recordings. */
  jobs?: () => Promise<readonly ReplayJob[]>;
  library?: UseLibraryOptions;
}

/** The recorded job behind a replay job id, once the recordings are read. */
function useReplayJob(jobId: string | undefined, jobs: () => Promise<readonly ReplayJob[]>): ReplayJob | undefined {
  const slug = jobId === undefined ? undefined : parseReplayJobId(jobId)?.slug;
  const [list, setList] = useState<readonly ReplayJob[] | undefined>(undefined);
  useEffect(() => {
    if (slug === undefined || list !== undefined) return undefined;
    let live = true;
    void jobs().then((all) => live && setList(all));
    return () => {
      live = false;
    };
  }, [slug, list, jobs]);
  return slug === undefined ? undefined : list?.find((j) => j.slug === slug);
}

/** Date.now(), every 100 ms while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** /creator with `id` selected, keeping the rest of the address (the plane). */
function handoffOf(id: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("character", id);
  return `/creator${url.search}`;
}

export function RitePage({ client: given, briefer: givenBriefer, jobs = loadReplayJobs, library: libraryOptions = {} }: RitePageProps) {
  const plane = usePlane();
  const seeded = useRef<ForgeErrorCode | undefined>(undefined);
  const client = useMemo(() => withSeededStart(given ?? planeClient(plane, window.location.search), () => seeded.current, { jobs }), [given, plane, jobs]);
  const job = useForgeJob(client);
  const handshake = useBrief(useMemo(() => givenBriefer ?? briefClientFor(plane), [givenBriefer, plane]));
  const drawn = useRef<CharacterBrief | undefined>(undefined);
  const library = useLibrary(libraryOptions);
  const [draft, setDraft] = useState<ForgeDraft>({ prompt: "" });
  const [bind, setBind] = useState<Bind>({});
  const [chosen, setChosen] = useState<0 | 1>(0);
  const [manual, setManual] = useState<Mark | undefined>(undefined);
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const [gesture, fireGesture] = useGesturePulse();
  const speaker = useSpeaker((line) => {
    if (line.reply.gesture !== undefined) fireGesture(line.reply.gesture);
  });

  const { state } = job;
  // An awake (or finished) job goes into the library once, bound as the visitor chose, and is
  // selected; faces that arrive later fold into it (useKept.ts).
  const { kept, shown, keepError, clear: forgetKept, dress } = useKept(state, library, bind, drawn);
  const assets = shown?.assets;
  const painting = state.phase === "running" && state.awake !== undefined;

  const jobId = state.phase === "running" || state.phase === "done" ? state.jobId : undefined;
  // The step on screen: the status the client last reported; a failure freezes the last one.
  const last = useRef<{ jobId: string; status: RunStep; at: number } | undefined>(undefined);
  if (state.phase === "running" && (last.current?.jobId !== state.jobId || last.current.status !== state.status)) {
    last.current = { jobId: state.jobId, status: state.status, at: Date.now() };
  }
  const replay = useReplayJob(jobId ?? (state.phase === "failed" ? last.current?.jobId : undefined), jobs);
  const recorded = plane === "replay" || jobId?.startsWith("replay_") === true;
  const fallback = (state.phase === "running" || state.phase === "done") && state.decomposition === "fallback";
  const expressions = state.phase === "running" || state.phase === "done" ? state.expressions : undefined;

  const step: RunStep | undefined = state.phase === "running" ? state.status : state.phase === "done" ? "done" : state.phase === "failed" ? last.current?.status : undefined;
  const now = useNow(state.phase === "running");
  const startedAt = state.phase === "running" ? (jobId === undefined ? undefined : parseReplayJobId(jobId)?.startedAt) ?? state.startedAt : undefined;
  const elapsed = startedAt === undefined ? 0 : Math.max(0, now - startedAt);
  const inStep =
    step === undefined || state.phase !== "running"
      ? 0
      : replay !== undefined
        ? elapsed - startOf(replay.steps, step)
        : now - (last.current?.at ?? now);
  const p = step === undefined ? 0 : state.phase === "failed" ? 1 : progressIn(step, inStep, replay?.steps);
  const layers = kept?.rig.layers ?? replay?.rig.layers;
  const slots = step === undefined || layers === undefined ? {} : slotsAt(layers, step, p);

  // Wake: once the face is drawn it flares and speaks one line.
  const woke = useRef<string | undefined>(undefined);
  const toggleLine = speaker.toggle;
  // Keyed on the record's id, not the record: a face folding in later does not cut the line short.
  const keptId = kept?.id;
  const drawnOnGlass = assets !== undefined;
  useEffect(() => {
    if (keptId === undefined || !drawnOnGlass || woke.current === keptId) return undefined;
    woke.current = keptId;
    fireGesture("flare");
    const timer = setTimeout(toggleLine, 900);
    return () => clearTimeout(timer);
  }, [keptId, drawnOnGlass, fireGesture, toggleLine]);

  const failure = state.phase === "failed" ? { code: state.code, message: state.message } : undefined;
  const describeFailure = failure !== undefined && DESCRIBE_CODES.includes(failure.code) ? failure : undefined;
  const at = markOf(painting ? "done" : state.phase, chosen, describeFailure === undefined ? "forge" : "describe");
  useEffect(() => setManual(undefined), [at]);
  const busy = state.phase === "running" || job.starting;
  // Words are briefed first (cast-forge 4.3); a drawing is drawn as it is.
  const words = requestOf({ prompt: draft.prompt }, bind);
  const hs = handshake.state;
  const approved = hs.phase === "ready" ? parseBrief(hs.brief) : undefined;
  const asked: { ok: true; request: ForgeRequest } | { ok: false; message: string } =
    draft.image !== undefined ? requestOf(draft, bind) : approved?.ok ? { ok: true, request: { mode: "brief", brief: approved.value } } : { ok: false, message: words.ok ? "approve the brief first" : words.message };
  const blocked = asked.ok ? undefined : asked.message;
  const briefBlocked = words.ok ? undefined : words.message;
  const askBrief = (): void => {
    if (words.ok && words.request.prompt !== undefined) handshake.ask(words.request.prompt);
  };

  const draw = (request: ForgeRequest): void => {
    seeded.current = undefined;
    forgetKept();
    drawn.current = request.brief;
    job.start(request);
  };
  const forge = (): void => {
    if (asked.ok) draw(asked.request);
  };
  const tryRealFace = (): void => {
    seeded.current = "refused_likeness";
    forgetKept();
    job.start({ mode: "prompt", prompt: draft.prompt.trim().length >= 10 ? draft.prompt.trim() : "A photograph of a real person's face" });
    seeded.current = undefined;
  };
  const edit = (): void => {
    job.reset();
    setChosen(0);
  };
  const again = (): void => {
    job.reset();
    handshake.reset();
    forgetKept();
    setChosen(0);
    woke.current = undefined;
  };

  const thumbsFromBlobs = useBlobUrls(kept?.assets);
  const thumbs = kept === undefined ? (replay?.assets ?? {}) : thumbsFromBlobs;
  const total = replay === undefined ? undefined : replay.steps.reduce((sum, s) => sum + s.holdMs, 0);
  const name = kept?.rig.name ?? (replay !== undefined && step !== undefined && RUN_STEPS.indexOf(step) >= 1 ? replay.name : undefined);
  const parts = (replay?.rig.layers ?? []).filter((l) => l.kind !== "static");
  const found = parts.filter((l) => slots[l.name] !== undefined && slots[l.name] !== "waiting").length;
  const cutCount = parts.filter((l) => slots[l.name] === "cut").length;
  const chip =
    failure !== undefined
      ? `stopped · ${failure.code}`
      : step === undefined
        ? "awaiting a description"
        : step === "queued"
          ? "waiting for the painter"
          : step === "portrait"
            ? "the portrait is being painted"
            : step === "segmenting"
              ? replay === undefined ? "finding the parts" : `${found} of ${parts.length} parts found`
              : step === "cutting"
                ? replay === undefined ? "cutting the layers" : `${cutCount} of ${parts.length} cut · lifting off the canvas`
                : step === "filling"
                  ? "background · filling behind the cuts"
                  : step === "expressing"
                    ? expressionsProgress(expressions ?? {})
                    : `alive · ${kept?.rig.layers.length ?? layers?.length ?? 0} layers`;
  const sub =
    failure !== undefined
      ? "the forge stopped"
      : step === undefined
        ? chosen === 1 ? "binding archetype, voice, palette" : "being described"
        : step === "done"
          ? `live rig, ${kept?.rig.layers.length ?? layers?.length ?? 0} layers`
          : `${STEP_VERB[step].toLowerCase()}…`;
  const lamp =
    kept !== undefined && assets !== undefined
      ? speaker.line === undefined ? "Alive · idle" : "Speaking"
      : total === undefined ? clockText(elapsed) : `${clockText(Math.min(elapsed, total))} / ${secText(total)}`;
  const typed = useTyped(speaker.line?.reply.line);
  const pal = bind.palette === undefined ? undefined : PALETTES[bind.palette];
  const summaries = [
    draft.image !== undefined ? `a drawing: ${draft.image.name}` : hs.phase === "ready" ? `brief: ${hs.brief.name} · ${hs.brief.parts.length} parts` : draft.prompt.trim() === "" ? "words or a drawing" : draft.prompt.trim(),
    [bind.archetype === undefined ? undefined : ARCHETYPES[bind.archetype], bind.voice === undefined ? undefined : VOICES[bind.voice].label.split(":")[0], pal?.[0]].filter(Boolean).join(" · ") || "archetype · voice · palette",
    failure !== undefined ? `stopped · ${failure.code}` : step === undefined || step === "done" ? (total === undefined ? "a real job" : `${replay?.steps.length ?? 0} recorded stages`) : `${STEP_VERB[step]} · ${clockText(elapsed)}`,
    kept === undefined ? "hand the face to the glass" : `${kept.rig.name} is awake`,
  ] as const;

  return (
    <div className={anatomy.anatomy} data-page="forge-new" data-step={step ?? "idle"} style={pal === undefined ? undefined : ({ "--lamp": pal[1] } as CSSProperties)}>
      <RiteRail
        {...(layers === undefined ? {} : { layers })}
        slots={slots}
        thumbs={thumbs}
        {...(kept === undefined ? {} : { alive: { hidden: kept.look.hidden, onToggle: (layer: string) => dress({ type: "toggle", layer }), onHighlight: setHighlight } })}
        recipe={
          replay === undefined
            ? "Each slot names its part when the forge finds it, and fills when the knife lands."
            : `Cut from portrait.jpg on a ${replay.rig.width}×${replay.rig.height} canvas. Each slot names its part when the forge finds it, and fills when the knife lands. Fill mode: ${replay.fill ?? "edit"} · parts: recorded`
        }
      />
      <section className={anatomy.centre} aria-label="The glass">
        <div className={anatomy.glassBox}>
          {kept !== undefined && shown !== undefined ? (
            <Glass
              rig={shown.rig}
              look={kept.look}
              assets={shown.assets}
              {...(gesture === undefined ? {} : { gesture })}
              {...(speaker.audio === undefined ? {} : { audio: speaker.audio })}
              {...(highlight === undefined ? {} : { highlight })}
              onPalette={(key, value) => dress({ type: "palette", key, value })}
              chip={chip}
            />
          ) : (
            <Developing
              {...(step === undefined ? {} : { step })}
              {...(replay === undefined ? {} : { rig: replay.rig })}
              parts={parts}
              slots={slots}
              {...(state.phase === "running" && state.portraitUrl !== undefined ? { portraitUrl: state.portraitUrl } : state.phase === "done" && state.portraitUrl !== undefined ? { portraitUrl: state.portraitUrl } : {})}
              {...(name === undefined ? {} : { name })}
              chip={chip}
              failed={failure !== undefined}
            />
          )}
        </div>
        <div className={anatomy.status}>
          <span>
            <b>{name ?? "Unnamed"}</b> · {sub}
          </span>
          <span className={styles.clock} data-alive={kept === undefined ? undefined : ""}>
            {lamp}
          </span>
        </div>
        <Tape recorded={recorded} {...(step === undefined ? {} : { step })} p={p} {...(replay === undefined ? {} : { steps: replay.steps, ...(replay.live === undefined ? {} : { live: replay.live }) })} />
        <p className={styles.transcript}>
          <span aria-hidden="true">{typed === "" ? "" : `“${typed}”`}</span>
          <span className={anatomy.srOnly} aria-live="polite">
            {speaker.line?.reply.line ?? ""}
          </span>
        </p>
      </section>
      <aside className={signal.signal} aria-label="The rite">
        <Marks
          at={at}
          open={manual ?? at}
          onOpen={(m) => setManual(manual === m ? undefined : m)}
          summaries={summaries}
          bodies={[
            <Describe
              key="d"
              draft={draft}
              onDraft={setDraft}
              busy={busy}
              {...(describeFailure === undefined ? {} : { refusal: describeFailure })}
              {...(recorded ? { onTryRealFace: tryRealFace } : {})}
              onNext={() => {
                if (state.phase === "failed") job.reset();
                setChosen(1);
                setManual(undefined);
              }}
              {...(blocked === undefined ? {} : { blocked })}
              onBrief={askBrief}
              {...(briefBlocked === undefined ? {} : { briefBlocked })}
              {...(hs.phase === "idle"
                ? {}
                : { brief: <Handshake state={hs} busy={busy} onEdit={handshake.edit} onDraw={(brief) => draw({ mode: "brief", brief })} onAgain={askBrief} /> })}
            />,
            <BindMark key="b" bind={bind} onBind={setBind} busy={busy} recorded={recorded} onForge={forge} {...(blocked === undefined ? {} : { blocked })} />,
            <ForgeMark
              key="f"
              {...(step === undefined ? {} : { step })}
              {...(replay === undefined ? {} : { steps: replay.steps, ...(replay.live === undefined ? {} : { live: replay.live }) })}
              {...(failure === undefined || describeFailure !== undefined ? {} : { failure })}
              recorded={recorded}
              fallback={fallback}
              {...(expressions === undefined ? {} : { expressions })}
              {...(state.phase === "failed" ? { onRetry: () => job.start(state.retry) } : {})}
              onEdit={edit}
            />,
            <WakeMark
              key="w"
              {...(kept === undefined ? {} : { name: kept.rig.name, layers: kept.rig.layers.length, handoff: handoffOf(kept.id), id: kept.id })}
              {...(expressions === undefined ? {} : { expressions })}
              {...(keepError === undefined ? {} : { keepError })}
              painting={painting}
              fallback={fallback}
            />,
          ]}
        />
        <div className={keys.foot}>
          <button type="button" className={keys.btn} onClick={again} disabled={busy || (state.phase !== "done" && state.phase !== "failed")}>
            ↻ Forge another
          </button>
          <a className={keys.btn} href="/creator" onClick={(event) => handleLinkClick(event, "/creator")}>
            Back to the Forge
          </a>
        </div>
      </aside>
    </div>
  );
}

export default RitePage;
