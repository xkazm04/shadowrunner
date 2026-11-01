// CH 9, lights out (costume task 5.2; requirement 7; r1/sealed-c.html "Lights Out, Nine"). A
// manifest page with status "sealed" renders this. The cellar is dark and the set is off; the
// pointer is a torch (CSS variables written through a ref, no render per move). A paper tag hangs
// on the set and says what this is: the channel, "Sealed · not built yet", its lore line, how to
// tune in, how to get back, and how often you have. Hold the knob (or Space) and the tube warms up
// to snow and the slate; let go and it collapses to a dot, and in its black glass the Announcer
// stands behind you, a little clearer every time (SealedGlass.reflection). No fake feature: the
// tube never shows a programme. Reduced motion: no stutter, no warm-up, a still frame of snow.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import crtFrontal from "../../../../assets/plates/crt-frontal.webp";
import announcer from "../../../../assets/replay/thumbs/announcer-of-dead-air.webp";
import type { PageDef } from "../app/pages";
import { handleLinkClick } from "../app/router";
import { usePreferences } from "../app/theme";
import { PLATE } from "../landing/superellipse";
import styles from "./Sealed.module.css";
import tagStyles from "./SealedTag.module.css";
import { GLASS_CLIP, GLASS_IN_PLATE, isSwitchOff, reflection, toGlass } from "./SealedGlass";

const SNOW_W = 240;
const SNOW_H = 194;
/** How long the Announcer lingers in the glass after a switch-off. */
const GLIMPSE_MS = 2800;

type Power = "idle" | "on" | "off";

/** Interactive elements keep Space for themselves; the knob is the one that hands it to us. */
function ownsSpace(target: EventTarget | null, knob: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement) || target === knob) return false;
  return target.isContentEditable || target.closest("a, button, input, select, textarea, summary, [role='button']") !== null;
}

export function Sealed({ page }: { page: PageDef }) {
  const { motion } = usePreferences();
  const [power, setPower] = useState<Power>("idle");
  const [tunedIn, setTunedIn] = useState(0);
  const [switchOffs, setSwitchOffs] = useState(0);
  const [releases, setReleases] = useState(0);
  const [glimpse, setGlimpse] = useState(false);
  const [said, setSaid] = useState("");
  const room = useRef<HTMLElement>(null);
  const set = useRef<HTMLElement>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const snow = useRef<HTMLCanvasElement>(null);
  const onAt = useRef<number | undefined>(undefined);

  const powerOn = useCallback(() => {
    if (onAt.current !== undefined) return;
    onAt.current = performance.now();
    setPower("on");
    setTunedIn((n) => n + 1);
    setGlimpse(false);
    setSaid("The set warms up to snow. Channel 9 · Sealed · not built yet.");
  }, []);

  const powerOff = useCallback(() => {
    const at = onAt.current;
    if (at === undefined) return;
    onAt.current = undefined;
    setPower("off");
    setReleases((n) => n + 1);
    if (isSwitchOff(performance.now() - at)) {
      setSwitchOffs((n) => n + 1);
      setGlimpse(true);
      setSaid("The tube goes dark. Something is reflected in the glass. Channel 9 is still not built.");
    } else setSaid("The tube goes dark.");
  }, []);

  // The Announcer lingers, then is gone (both motions; full motion also animates the glimpse).
  useEffect(() => {
    if (!glimpse) return;
    const id = window.setTimeout(() => setGlimpse(false), GLIMPSE_MS);
    return () => window.clearTimeout(id);
  }, [glimpse, switchOffs]);

  // Space holds the knob from anywhere on the page; Enter holds it while it has focus.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const space = e.code === "Space" || e.key === " ";
      const enter = e.key === "Enter" && e.target === knob.current;
      if (!space && !enter) return;
      if (space && ownsSpace(e.target, knob.current)) return;
      e.preventDefault();
      if (!e.repeat) powerOn();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " " || e.key === "Enter") powerOff();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", powerOff);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", powerOff);
    };
  }, [powerOn, powerOff]);

  // Snow while the tube is on (every 40 ms); its brightness flickers the light the tube throws.
  useEffect(() => {
    const canvas = snow.current;
    const ctx = canvas?.getContext("2d");
    if (power !== "on" || !canvas || !ctx) return;
    const img = ctx.createImageData(SNOW_W, SNOW_H);
    const d = img.data;
    let raf = 0;
    let last = -Infinity;
    const draw = (ts: number) => {
      if (ts - last > 40) {
        last = ts;
        let sum = 0;
        for (let k = 0; k < d.length; k += 4) {
          const v = (Math.random() * 220) | 0;
          d[k] = v;
          d[k + 1] = v;
          d[k + 2] = Math.min(255, v + 12);
          d[k + 3] = 255;
          sum += v;
        }
        ctx.putImageData(img, 0, 0);
        room.current?.style.setProperty("--flick", (0.75 + (sum / (SNOW_W * SNOW_H) / 255) * 0.5).toFixed(3));
      }
      if (motion === "full") raf = window.requestAnimationFrame(draw);
    };
    draw(0);
    return () => window.cancelAnimationFrame(raf);
  }, [power, motion]);

  // The torch: the pointer's place in the set, and its highlight on the glass.
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const r = set.current?.getBoundingClientRect();
    const el = room.current;
    if (!r || !el || r.width === 0) return;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    const g = toGlass(x, y);
    el.style.setProperty("--mx", `${x.toFixed(2)}%`);
    el.style.setProperty("--my", `${y.toFixed(2)}%`);
    el.style.setProperty("--gx", `${g.x.toFixed(2)}%`);
    el.style.setProperty("--gy", `${g.y.toFixed(2)}%`);
    el.style.setProperty("--ring-x", `${e.clientX}px`);
    el.style.setProperty("--ring-y", `${e.clientY}px`);
  };

  const knobDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    powerOn();
  };

  const kick = page.channel === undefined ? page.title : `Channel ${page.channel} · ${page.title}`;
  const tag = page.channel === undefined ? page.title : `CH ${page.channel}`;
  const { peak, width } = reflection(switchOffs);
  const reflVars = { "--peak": peak.toFixed(3), "--refl-w": `${(width * 100).toFixed(1)}%` } as CSSProperties;
  return (
    <section
      ref={room}
      className={styles.cellar}
      data-door="sealed"
      data-power={power}
      aria-labelledby="page-title"
      onPointerMove={onPointerMove}
    >
      <figure
        ref={set}
        className={styles.set}
        style={GLASS_IN_PLATE}
        aria-label={`A television set in a dark cellar, switched off. ${kick} is sealed and not built yet.`}
      >
        <img className={`${styles.layer} ${styles.base}`} src={crtFrontal} alt="" width={PLATE.width} height={PLATE.height} />
        <img className={`${styles.layer} ${styles.tubelit}`} src={crtFrontal} alt="" width={PLATE.width} height={PLATE.height} />
        <img className={`${styles.layer} ${styles.torch}`} src={crtFrontal} alt="" width={PLATE.width} height={PLATE.height} />
        <div className={styles.edge} aria-hidden="true" />
        <div className={styles.glass} style={{ clipPath: GLASS_CLIP }}>
          <div className={styles.sheen} aria-hidden="true" />
          {glimpse && (
            <img key={`refl-${switchOffs}`} className={styles.refl} src={announcer} alt="" style={reflVars} data-refl={switchOffs} aria-hidden="true" />
          )}
          <div key={`screen-${tunedIn}`} className={styles.screen} data-power={power}>
            <canvas ref={snow} width={SNOW_W} height={SNOW_H} aria-hidden="true" />
            <div className={styles.slate}>
              <p>{kick}</p>
              <h1 id="page-title">Not built yet</h1>
            </div>
            <div className={styles.scan} aria-hidden="true" />
          </div>
          {releases > 0 && <div key={`dot-${releases}`} className={styles.dot} aria-hidden="true" />}
        </div>
        <button
          ref={knob}
          type="button"
          className={tagStyles.power}
          aria-pressed={power === "on"}
          aria-label={`Power. Hold to tune the set to ${kick}`}
          onPointerDown={knobDown}
          onPointerUp={powerOff}
          onPointerCancel={powerOff}
          onLostPointerCapture={powerOff}
        >
          <span className={tagStyles.lab}>Hold ⏻ or Space</span>
        </button>
        <aside className={tagStyles.tag} aria-label="Label on the set">
          <h2>{tag}</h2>
          <p className={tagStyles.st}>{page.title} · not built yet</p>
          {page.lore !== undefined && <p>{page.lore}</p>}
          <hr />
          <p className={tagStyles.how}>Hold the power knob (or Space) to tune in. There is no programme; only snow.</p>
          <p className={tagStyles.how}>
            Esc or 2:{" "}
            <a href="/" onClick={(e) => handleLinkClick(e, "/")}>
              back to the set
            </a>
            .
          </p>
          <hr />
          <p className={tagStyles.log} data-counts>
            tuned in: {tunedIn}
            <br />
            tuned back: {switchOffs > 0 ? <b>{switchOffs}</b> : 0}
          </p>
        </aside>
      </figure>
      <span className={tagStyles.ring} aria-hidden="true" />
      <p className={styles.sr} aria-live="polite">
        {said}
      </p>
    </section>
  );
}
