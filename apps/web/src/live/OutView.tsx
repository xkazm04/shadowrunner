// The out stream (spec flashhead-live, task 3.4): an `out` client, its player on a canvas, and the
// slide the control page relayed. Iris is centred on a transparent page; while a slide shows it
// fills the frame and Iris sits in a corner. Used bare by `/live?out=1` (OBS) and small, silent,
// as the control page's preview. Measured figures go on data attributes for the e2e test.
// Round 2: matted frames keep the page transparent outside the matte (player.ts, composite.ts);
// the server's stop marker (`line-end` "stopped") flushes the player, and so does a change of
// `flushes` (the control page's own Stop, for its preview, without waiting for the marker).
import { useEffect, useRef, useState, type ReactElement } from "react";
import { connectLive, type ConnectionStatus } from "./client";
import type { Corner } from "./params";
import { createPlayer, type Player } from "./player";
import { STOPPED } from "./protocol";
import styles from "./Out.module.css";

export interface OutViewProps {
  server: string;
  /** Play the sound (the OBS view) or not (the preview). */
  audio: boolean;
  corner: Corner;
  showSlides: boolean;
  variant: "page" | "preview";
  /** Bumped by the control page's Stop: flush the preview at once. */
  flushes?: number;
}

interface ShownSlide {
  index: number;
  url: string;
}

const CORNER_CLASS: Readonly<Record<Corner, string | undefined>> = { br: styles.br, bl: styles.bl, tr: styles.tr, tl: styles.tl };

export const START_SOUND = "Click to start the sound.";

const ms = (value: number): string => value.toFixed(2);

export function OutView({ server, audio, corner, showSlides, variant, flushes = 0 }: OutViewProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting" });
  const [gesture, setGesture] = useState(false);
  const [slide, setSlide] = useState<ShownSlide | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (canvas === null || root === null) return;
    const player = createPlayer({ canvas, audio, onGesture: setGesture });
    playerRef.current = player;
    const live = connectLive({
      url: server,
      role: "out",
      onStatus: (next) => {
        if (next.kind === "open") player.reset();
        setStatus(next);
      },
      onMessage: (message) => {
        if (message.type === "event" && message.kind === "line-end" && message.text === STOPPED) player.flush();
      },
      onMedia: (media) => {
        if (media.kind !== "slide") return player.push(media);
        if (!showSlides) return;
        // An empty image clears the slide (Iris back in the centre).
        const url = media.image.byteLength === 0 ? undefined : URL.createObjectURL(new Blob([new Uint8Array(media.image)]));
        setSlide(url === undefined ? undefined : { index: media.index, url });
      },
    });
    // The figures the e2e test reads (no re-render: written straight to the element).
    const meter = window.setInterval(() => {
      const stats = player.stats;
      root.dataset.drawn = String(stats.drawn);
      root.dataset.dropped = String(stats.dropped);
      root.dataset.chunks = String(stats.chunks);
      root.dataset.size = `${stats.width}x${stats.height}`;
      root.dataset.flushes = String(stats.flushes);
      root.dataset.audioAhead = String(Math.round(stats.audioAheadMs));
      root.dataset.drawP50 = ms(stats.drawP50);
      root.dataset.drawP95 = ms(stats.drawP95);
      root.dataset.decodeP95 = ms(stats.decodeP95);
      if (stats.composite !== undefined) root.dataset.composite = stats.composite;
    }, 250);
    return () => {
      window.clearInterval(meter);
      live.close();
      player.dispose();
      playerRef.current = undefined;
      setSlide(undefined);
    };
  }, [server, audio, showSlides]);

  useEffect(() => () => (slide === undefined ? undefined : URL.revokeObjectURL(slide.url)), [slide]);
  useEffect(() => {
    if (flushes > 0) playerRef.current?.flush();
  }, [flushes]);

  const withSlide = slide !== undefined;
  const irisClass = withSlide ? `${styles.iris} ${styles.cornered} ${CORNER_CLASS[corner] ?? ""}` : styles.iris;
  return (
    <div
      ref={rootRef}
      className={variant === "page" ? styles.page : styles.preview}
      data-live-out={variant}
      data-status={status.kind}
      data-slide={slide?.index}
    >
      {withSlide && <img className={styles.slide} src={slide.url} alt={`Slide ${slide.index + 1}`} />}
      <canvas ref={canvasRef} className={irisClass} width={0} height={0} aria-label="Iris, live" />
      {gesture && audio && (
        <button type="button" className={styles.gesture} onClick={() => void playerRef.current?.resume()}>
          {START_SOUND}
        </button>
      )}
      <p className={styles.hidden} role="status">
        {status.kind === "open" ? "Live stream connected." : "Waiting for the live server."}
      </p>
    </div>
  );
}
