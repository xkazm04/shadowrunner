// The set's glass (landing requirement 3.2-3.5, design.md "Glass geometry"). One superellipse clip,
// in percentages of the plate box, holds every layer of the picture: the dark tube, the live
// <AvatarCanvas> (Picture.tsx, a lazy chunk loaded after the page's own load, so the cellar plate
// stays the LCP and first load stays light), the cold phosphor grade, the scanlines, the carrier
// (Carrier.tsx: fold to a dot, dead glass), the barrel vignette, the plate's own glare, the rim
// shadow, and on top the lower third and the channel caption written by a hovered gourd.
// The lower third sits on a translucent surface-0 band, so phosphor clears 4.5:1 on any picture
// (measured on the rendered set in e2e/landing.visual.spec.ts).
import type { RigAssets } from "@sr/avatar";
import type { Look, Rig } from "@sr/rig";
import { Component, lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { PageDef } from "../app/pages";
import type { Plane } from "../app/plane";
import type { Motion } from "../app/theme";
import { Carrier } from "./Carrier";
import { FOLD_MS, isLost, relightMs, type DaemonState } from "./daemon";
import styles from "./Glass.module.css";
import { LIGHTS } from "./Gourds";
import { clipPolygon, GLASS, PLATE, superellipse } from "./superellipse";

const Picture = lazy(() => import("./Picture"));

/** A character on the set: its rig, its look, and the images keyed by `Layer.file`. */
export interface OnAirCharacter {
  name: string;
  rig: Rig;
  look: Look;
  assets: RigAssets;
}

/** Who is on the set when the user has put nobody on air. */
export const RESIDENT = "Arch-Lich Malakor";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const pct = (v: number) => `${v.toFixed(4)}%`;

/** The glass superellipse as a clip-path polygon in percentages of the plate. */
export const GLASS_CLIP = clipPolygon(superellipse(GLASS, 96), PLATE);

/** The glass box inside the plate, as percentages of the plate. */
export const GLASS_BOX: Vars = {
  "--glass-x": pct(((GLASS.cx - GLASS.a) / PLATE.width) * 100),
  "--glass-y": pct(((GLASS.cy - GLASS.b) / PLATE.height) * 100),
  "--glass-w": pct(((2 * GLASS.a) / PLATE.width) * 100),
  "--glass-h": pct(((2 * GLASS.b) / PLATE.height) * 100),
};

/**
 * The picture's frame in plate px, after the reference's drawPicture: the 1024 px rig drawn
 * square, its point (512, 392) on the glass centre line at 47% of the photographed tube
 * (340, 219, 514x416). 540 px square (the reference's 507.5 plus the 6% his crown spreads wider
 * there) matches the head's size in R4-1-1600x900-load.png. It overhangs the glass at the bottom;
 * the clip cuts it.
 */
const SIZE = 540;
export const PICTURE = { x: 597 - SIZE / 2, y: 219 + 416 * 0.47 - SIZE * (392 / 1024), size: SIZE } as const;

const PICTURE_BOX: Vars = {
  "--pic-x": pct((PICTURE.x / PLATE.width) * 100),
  "--pic-y": pct((PICTURE.y / PLATE.height) * 100),
  "--pic-w": pct((PICTURE.size / PLATE.width) * 100),
  "--pic-h": pct((PICTURE.size / PLATE.height) * 100),
};

/** The glass's clip and the picture's fold timing (daemon.ts), shared by its layers. */
const GLASS_STYLE: Vars = { clipPath: GLASS_CLIP, "--fold": `${FOLD_MS}ms`, "--unfold": `${relightMs(LIGHTS)}ms` };

/** True once the page has loaded (plates first): the picture's chunk and images come after. */
function useAfterLoad(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (document.readyState === "complete") {
      setLoaded(true);
      return undefined;
    }
    const done = () => setLoaded(true);
    window.addEventListener("load", done, { once: true });
    return () => window.removeEventListener("load", done);
  }, []);
  return loaded;
}

/** A picture that cannot render (no GPU, no 2D, images missing) leaves the tube dark, not the page. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface GlassCaptionProps {
  /** The hovered or focused channel; nothing is written without one. */
  page?: PageDef;
}

/**
 * The channel written across the glass: its number, its name large, its subtitle, over the picture
 * dimmed to a dark band so phosphor clears 4.5:1 on any picture.
 */
export function GlassCaption({ page }: GlassCaptionProps) {
  if (!page) return null;
  const name = page.title.toUpperCase();
  return (
    <div className={styles.dim} data-glass-caption aria-hidden="true">
      <div className={styles.caption} style={GLASS_BOX}>
        {page.channel !== undefined && <p className={styles.kick}>{`Channel ${page.channel}`}</p>}
        <svg className={styles.big} viewBox="0 0 480 96" focusable="false">
          <text x="240" y="50" textAnchor="middle" dominantBaseline="central" fontSize="84">
            {name}
          </text>
        </svg>
        {page.subtitle && <p className={styles.sub}>{page.subtitle}</p>}
      </div>
    </div>
  );
}

export interface LowerThirdProps {
  daemon: DaemonState;
  plane: Plane;
  /** Who is live on the set. */
  name: string;
}

/** "LIVE · <character>" and one line while there is a picture; NO CARRIER once it is gone. */
export function LowerThird({ daemon, plane, name }: LowerThirdProps) {
  if (daemon === "dark") {
    return (
      <p className={`${styles.third} ${styles.dead}`} data-no-carrier>
        <span className={styles.title}>NO CARRIER</span>
        {/* Only the replay sample answers D; on live the daemon has to come back by itself. */}
        <span className={styles.line}>
          {plane === "replay" ? "Press D to re-seat the daemon" : "Waiting for the daemon to return"}
        </span>
      </p>
    );
  }
  if (daemon !== "online") return null;
  return (
    <p className={styles.third} data-lower-third>
      <span className={styles.title}>{`LIVE · ${name}`}</span>
      {/* In portrait the line breaks at its dot, so it holds 14 px on the narrow glass. */}
      <span className={styles.line}>
        <span className={styles.part}>AI characters who stream</span>
        <span className={styles.dot}> · </span>
        <span className={styles.part}>you are the only viewer</span>
      </span>
    </p>
  );
}

export interface GlassProps {
  daemon: DaemonState;
  plane: Plane;
  motion?: Motion;
  hover?: PageDef;
  character?: OnAirCharacter;
}

export function Glass({ daemon, plane, hover, character }: GlassProps) {
  const loaded = useAfterLoad();
  const name = character?.name ?? RESIDENT;
  const caption = !isLost(daemon) && hover !== undefined;
  return (
    <div className={styles.glass} style={GLASS_STYLE} data-glass data-daemon={daemon} data-hover={caption || undefined}>
      <div className={styles.tube} aria-hidden="true" />
      <div className={styles.picture} style={PICTURE_BOX} role="img" aria-label={`The set's picture: ${name} on air (stylised, live rig)`}>
        {loaded && (
          <Quiet>
            <Suspense fallback={null}>
              <Picture className={styles.face} {...(character === undefined ? {} : { character })} />
            </Suspense>
          </Quiet>
        )}
      </div>
      <div className={styles.tint} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />
      <Carrier daemon={daemon} />
      <div className={styles.barrel} aria-hidden="true" />
      <div className={styles.glare} aria-hidden="true" />
      <div className={styles.rim} aria-hidden="true" />
      <div className={styles.text}>
        <LowerThird daemon={daemon} plane={plane} name={name} />
      </div>
      {caption && <GlassCaption page={hover} />}
    </div>
  );
}
