// The Slides tab (spec flashhead-live, task 3.3): pick a folder of slide images plus `script.md`;
// Start shows slide 1 on the out view (`slide` + its 0x13 image) and Iris speaks its lines (`say`,
// ids `slide-<n>-<k>`); the deck moves on when the slide's last `line-end` arrives (slides.ts).
// Commands go out through one promise chain, so a slide's image always precedes its lines.
// Clearing a slide (Director ruling, flashhead-live design.md) is `slide` with the shown index
// followed by an EMPTY 0x13: sent when the deck ends, on the page's Stop, and on "Clear slide".
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { encodeSlide, type ClientMessage } from "./protocol";
import { buildDeck, SCRIPT_NAME, SlideDeck, type DeckCommand, type DeckView } from "./slides";
import type { Listener } from "./useLive";
import list from "./Log.module.css";
import styles from "./Live.module.css";

export interface SlidesTabProps {
  open: boolean;
  send: (message: ClientMessage) => boolean;
  sendBinary: (data: ArrayBuffer) => boolean;
  say: (text: string, origin: "slide", id: string) => boolean;
  listen: (listener: Listener) => () => void;
  /** Bumped by the page's Stop: the deck ends where it is. */
  stops: number;
}

export function SlidesTab({ open, send, sendBinary, say, listen, stops }: SlidesTabProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const deck = useRef<SlideDeck | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const hold = useRef<number | undefined>(undefined);
  /** The slide this page last put on the out view, until it is cleared. */
  const shown = useRef<number | undefined>(undefined);
  const [view, setView] = useState<DeckView | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);

  // webkitdirectory is not in React's input attributes: set it on the element.
  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
  }, []);

  const io = useRef({ send, sendBinary, say });
  io.current = { send, sendBinary, say };

  /** Take the slide off the out view (Iris back to the centre). */
  const clear = () => {
    const index = shown.current ?? 0;
    shown.current = undefined;
    chain.current = chain.current.then(() => {
      const { send: tell, sendBinary: upload } = io.current;
      tell({ type: "slide", index });
      upload(encodeSlide(new Uint8Array(0)));
    });
  };

  const run = (commands: DeckCommand[]) => {
    const current = deck.current;
    if (current === undefined) return;
    for (const command of commands) {
      chain.current = chain.current.then(async () => {
        const { send: tell, sendBinary: upload, say: speak } = io.current;
        if (command.kind === "stop") tell({ type: "stop" });
        else if (command.kind === "slide") {
          const bytes = new Uint8Array(await command.file.arrayBuffer());
          if (deck.current !== current) return;
          tell({ type: "slide", index: command.index });
          upload(encodeSlide(bytes));
          shown.current = command.index;
        } else if (command.kind === "done") {
          if (shown.current !== undefined) clear();
        } else if (command.kind === "say") speak(command.text, "slide", command.id);
        else if (command.kind === "hold") {
          window.clearTimeout(hold.current);
          hold.current = window.setTimeout(() => run(current.held(command.token)), command.ms);
        }
      });
    }
    setView(current.view);
  };

  useEffect(
    () =>
      listen((message) => {
        if (message.type === "event" && message.kind === "line-end" && deck.current !== undefined) run(deck.current.lineEnd(message.id));
      }),
    // run reads refs only.
    [listen],
  );

  useEffect(() => {
    if (stops === 0) return;
    window.clearTimeout(hold.current);
    if (shown.current !== undefined) clear();
    if (deck.current === undefined) return;
    deck.current.end();
    setView(deck.current.view);
    // clear reads refs only.
  }, [stops]);

  useEffect(() => () => window.clearTimeout(hold.current), []);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    const script = files.find((f) => f.name.toLowerCase() === SCRIPT_NAME);
    const slides = buildDeck(
      files.map((f) => ({ name: f.name, file: f })),
      script === undefined ? undefined : await script.text(),
    );
    window.clearTimeout(hold.current);
    deck.current = slides.length === 0 ? undefined : new SlideDeck(slides);
    setView(deck.current?.view);
    setNote(
      slides.length === 0
        ? "No images (PNG, JPEG or WebP) in that folder."
        : script === undefined
          ? `${slides.length} slides, no ${SCRIPT_NAME}: each slide holds a few seconds.`
          : `${slides.length} slides, ${slides.reduce((n, s) => n + s.lines.length, 0)} lines.`,
    );
  };

  const act = (action: (d: SlideDeck) => DeckCommand[]) => {
    if (deck.current === undefined) return;
    window.clearTimeout(hold.current);
    run(action(deck.current));
  };

  const slides = deck.current?.slides ?? [];
  const started = view !== undefined && view.index >= 0;
  const running = view !== undefined && (view.phase === "speaking" || view.phase === "held" || view.phase === "finished-slide");
  return (
    <div className={styles.tabBody}>
      <label className={styles.field}>
        <span>
          Slides folder: images sorted by name, plus <code className={styles.code}>{SCRIPT_NAME}</code> with <code className={styles.code}>## 1</code>,{" "}
          <code className={styles.code}>## 2</code>… sections, one line per paragraph.
        </span>
        <input ref={input} type="file" multiple onChange={(e) => void pick(e)} className={styles.file} data-live="slides-input" />
      </label>
      {note !== undefined && <p className={styles.hint}>{note}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={!open || slides.length === 0} onClick={() => act((d) => d.start())}>
          {started ? "Restart" : "Start"}
        </button>
        <button type="button" className={styles.small} disabled={!open || !started} onClick={() => act((d) => d.prev())}>
          Previous
        </button>
        <button type="button" className={styles.small} disabled={!open || slides.length === 0} onClick={() => act((d) => d.next())}>
          Next
        </button>
        {view?.paused ? (
          <button type="button" className={styles.small} disabled={!open} onClick={() => act((d) => d.resume())}>
            Resume
          </button>
        ) : (
          <button type="button" className={styles.small} disabled={!open || !running} onClick={() => act((d) => d.pause())}>
            Pause
          </button>
        )}
        <button type="button" className={styles.small} disabled={!open} onClick={clear} data-live="slide-clear">
          Clear slide
        </button>
      </div>
      {slides.length > 0 && (
        <ol className={list.history} aria-label="Slides">
          {slides.map((slide, i) => (
            <li key={slide.name} className={list.entry} aria-current={view?.index === i ? "step" : undefined} data-slide-row={i}>
              <span className={list.entryText}>{slide.name}</span>
              <span className={list.entryMeta}>
                {slide.lines.length === 1 ? "1 line" : `${slide.lines.length} lines`}
                {view?.index === i ? ` · ${view.paused ? "paused" : view.phase}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      {view?.phase === "done" && <p className={styles.hint}>The deck is done; the out view is back to Iris alone.</p>}
    </div>
  );
}
