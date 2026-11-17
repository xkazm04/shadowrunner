// /live, the control page (spec flashhead-live, task 3.3): the connection to the live server and
// its `state` line, the upscaler switch and Stop, four tabs (Lines, Chat, Puppet, Slides) and a
// silent preview of the out stream. With the server down it shows how to start it.
//
// Decisions the spec leaves open:
// - Every tab stays mounted (hidden when not shown): a running deck or mic keeps going while
//   another tab is open.
// - The upscaler shows the requested kind until the server's `state` confirms it or an `error`
//   arrives; an error no line or turn claims shows under the toolbar.
// - Stop also ends the slide deck where it is, and flushes the preview at once (round 2).
// - The matte switch, like the upscaler, shows the request until `state.matte` confirms it.
// - The motion switch (round 3) does the same with `state.motion`; an older server sends no
//   `motion`, so nothing is checked and the state line leaves it out.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { ChatTab } from "./ChatTab";
import { EmptyState } from "./EmptyState";
import { LinesTab } from "./LinesTab";
import { addLine, addTurn, looseError, updateChat, updateLines, type ChatTurn, type LineRecord } from "./log";
import { OutView } from "./OutView";
import { newId, outUrl } from "./params";
import { DEFAULT_SERVER, MOTION_LEVELS, UPSCALE_KINDS, type LiveState, type MotionLevel, type UpscaleKind } from "./protocol";
import { PuppetTab } from "./PuppetTab";
import { SlidesTab } from "./SlidesTab";
import { useLiveControl } from "./useLive";
import styles from "./Live.module.css";

const TABS = [
  { id: "lines", label: "Lines" },
  { id: "chat", label: "Chat" },
  { id: "puppet", label: "Puppet" },
  { id: "slides", label: "Slides" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const UPSCALE_LABEL: Readonly<Record<UpscaleKind, string>> = { none: "None", realesrgan: "Real-ESRGAN", maxine: "Maxine", iris: "Iris" };
const MATTE_CHOICES = [
  { on: false, label: "Off" },
  { on: true, label: "On" },
] as const;
const MOTION_LABEL: Readonly<Record<MotionLevel, string>> = { off: "Off", natural: "Natural", lively: "Lively" };
export const NOT_CONNECTED = "Not sent: the live server is not connected.";
export const MIC_ON = "Puppet mode is on: stop the microphone to type lines.";

export function stateLine(state: LiveState): string {
  return [
    state.ready ? "ready" : "warming up",
    `${state.fps} fps`,
    `upscale ${state.upscale}`,
    `delay ${state.delayMs} ms`,
    `queue ${state.queue}`,
    `${state.size} px`,
    `source ${state.source}`,
    `matte ${state.matte ? "on" : "off"}`,
    ...(state.idle === null ? [] : [`idle ${state.idle}`]),
    ...(state.motion === null ? [] : [`motion ${state.motion}`]),
  ].join(" · ");
}

export function ControlPage({ server }: { server: string }): ReactElement {
  const live = useLiveControl(server);
  const { status, state, send, sendBinary, listen } = live;
  const open = status.kind === "open";
  const [tab, setTab] = useState<TabId>("lines");
  const [lines, setLines] = useState<LineRecord[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [requested, setRequested] = useState<UpscaleKind | undefined>(undefined);
  const [matteAsked, setMatteAsked] = useState<boolean | undefined>(undefined);
  const [motionAsked, setMotionAsked] = useState<MotionLevel | undefined>(undefined);
  const [stops, setStops] = useState(0);
  const known = useRef(new Set<string>());
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  useEffect(
    () =>
      listen((message) => {
        setLines((l) => updateLines(l, message));
        setTurns((t) => updateChat(t, message));
        const loose = looseError(message, (id) => known.current.has(id));
        if (loose !== undefined) {
          setError(loose);
          setRequested(undefined);
          setMatteAsked(undefined);
          setMotionAsked(undefined);
        }
      }),
    [listen],
  );
  useEffect(() => {
    if (requested !== undefined && state?.upscale === requested) setRequested(undefined);
    if (matteAsked !== undefined && state?.matte === matteAsked) setMatteAsked(undefined);
    if (motionAsked !== undefined && state?.motion === motionAsked) setMotionAsked(undefined);
  }, [state, requested, matteAsked, motionAsked]);

  const say = useCallback(
    (text: string, origin: LineRecord["origin"], id: string = newId("line")): boolean => {
      known.current.add(id);
      const ok = send({ type: "say", id, text });
      setLines((l) => addLine(l, { id, text, origin, status: ok ? "sent" : "error", ...(ok ? {} : { error: NOT_CONNECTED }) }));
      return ok;
    },
    [send],
  );

  const chat = useCallback(
    (text: string): boolean => {
      const id = newId("chat");
      known.current.add(id);
      const ok = send({ type: "chat", id, text });
      setTurns((t) => addTurn(t, { id, text, reply: [], status: ok ? "waiting" : "error", ...(ok ? {} : { error: NOT_CONNECTED }) }));
      return ok;
    },
    [send],
  );

  const stop = () => {
    send({ type: "stop" });
    setStops((n) => n + 1);
  };

  const upscale = (kind: UpscaleKind) => {
    setError(undefined);
    if (send({ type: "upscale", kind })) setRequested(kind);
  };

  const matte = (on: boolean) => {
    setError(undefined);
    if (send({ type: "matte", on })) setMatteAsked(on);
  };

  const motion = (level: MotionLevel) => {
    setError(undefined);
    if (send({ type: "motion", level })) setMotionAsked(level);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    if (next === undefined) return;
    setTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const mic = state?.source === "mic";
  const blocked = !open ? NOT_CONNECTED : mic ? MIC_ON : undefined;
  const shownUpscale = requested ?? state?.upscale;
  const shownMatte = matteAsked ?? state?.matte;
  const shownMotion = motionAsked ?? state?.motion;
  const obs = outUrl(typeof window === "undefined" ? "" : window.location.origin, server, DEFAULT_SERVER);

  return (
    <section data-page="live" aria-label="Live" className={styles.live} data-status={status.kind}>
      <div className={styles.main}>
        <div className={styles.bar}>
          <p className={styles.connection} data-live="connection">
            <span className={styles.lamp} data-on={open} aria-hidden="true" />
            {open ? "Connected" : status.kind === "refused" ? "Refused" : status.kind === "down" ? "Not running" : "Connecting…"}
            <span className={styles.hint}> {server}</span>
          </p>
          {state !== undefined && (
            <p className={styles.stateLine} data-live="state">
              {stateLine(state)}
            </p>
          )}
        </div>
        {!open && status.kind !== "connecting" && <EmptyState status={status} server={server} />}
        <div className={styles.toolbar}>
          <fieldset className={styles.segmented} disabled={!open}>
            <legend className={styles.legend}>Upscaler</legend>
            {UPSCALE_KINDS.map((kind) => (
              <label key={kind} className={styles.segment}>
                <input type="radio" name="upscale" value={kind} checked={shownUpscale === kind} onChange={() => upscale(kind)} />
                <span>{UPSCALE_LABEL[kind]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.segmented} disabled={!open} data-live="matte">
            <legend className={styles.legend}>Matte</legend>
            {MATTE_CHOICES.map(({ on, label }) => (
              <label key={label} className={styles.segment}>
                <input type="radio" name="matte" value={label.toLowerCase()} checked={shownMatte === on} onChange={() => matte(on)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.segmented} disabled={!open} data-live="motion">
            <legend className={styles.legend}>Motion</legend>
            {MOTION_LEVELS.map((level) => (
              <label key={level} className={styles.segment}>
                <input type="radio" name="motion" value={level} checked={shownMotion === level} onChange={() => motion(level)} />
                <span>{MOTION_LABEL[level]}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className={styles.stop} onClick={stop} disabled={!open} data-live="stop">
            Stop
          </button>
        </div>
        {error !== undefined && (
          <p role="alert" className={styles.error} data-live="error">
            {error}{" "}
            <button type="button" className={styles.small} onClick={() => setError(undefined)}>
              Dismiss
            </button>
          </p>
        )}
        <div role="tablist" aria-label="Modes" className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el === null) tabRefs.current.delete(t.id);
                else tabRefs.current.set(t.id, el);
              }}
              type="button"
              role="tab"
              id={`live-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`live-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              {t.label}
            </button>
          ))}
        </div>
        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={`live-panel-${t.id}`} aria-labelledby={`live-tab-${t.id}`} hidden={tab !== t.id} className={styles.panel}>
            {t.id === "lines" && <LinesTab lines={lines} onSay={(text) => say(text, "line")} blocked={blocked} />}
            {t.id === "chat" && <ChatTab turns={turns} onChat={chat} blocked={blocked} />}
            {t.id === "puppet" && <PuppetTab open={open} mic={mic} send={send} sendBinary={sendBinary} />}
            {t.id === "slides" && <SlidesTab open={open} send={send} sendBinary={sendBinary} say={say} listen={listen} stops={stops} />}
          </div>
        ))}
      </div>
      <aside className={styles.side} aria-label="Preview">
        <h2 className={styles.heading}>Preview</h2>
        <OutView server={server} audio={false} corner="br" showSlides variant="preview" flushes={stops} />
        <p className={styles.hint}>
          OBS browser source:{" "}
          <a className={styles.link} href={obs} target="_blank" rel="noreferrer">
            {obs}
          </a>
        </p>
      </aside>
    </section>
  );
}
