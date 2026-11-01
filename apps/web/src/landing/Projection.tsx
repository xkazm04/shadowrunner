// The lantern's throw (costume requirement 3.2; prototype `.proj` and `.beam`): a pulled slide
// projects its still onto the wall behind Malakor as a sepia ghost, through a beam of dust from the
// slide to the wall. The ghost is held well under the face's brightness (Projection.module.css;
// measured in e2e/landing.visual.spec.ts), and the face stands in front of it. The channel you are
// standing in does not project, and nothing projects while the lantern is cold (daemon lost).
// The ghost catches with a flicker of the lamp (motion only) and fades out when the slide goes back.
import { useLayoutEffect, useRef, useState } from "react";
import type { PageDef, PageId } from "../app/pages";
import styles from "./Projection.module.css";
import { projects } from "./slides";
import { Still } from "./Still";

/** Pure: a CSS polygon from the top of the slide's glass to the foot of the picture, in % of `box`. */
export function beamPolygon(
  slide: { left: number; top: number; width: number },
  picture: { left: number; top: number; width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): string {
  const px = (x: number) => (box.width > 0 ? ((x - box.left) / box.width) * 100 : 0);
  const py = (y: number) => (box.height > 0 ? ((y - box.top) / box.height) * 100 : 0);
  const sx = slide.left + slide.width / 2;
  const sy = slide.top + 8;
  const foot = picture.top + picture.height * 0.86;
  const pts: [number, number][] = [
    [sx - slide.width * 0.32, sy],
    [sx + slide.width * 0.32, sy],
    [picture.left + picture.width * 0.88, foot],
    [picture.left + picture.width * 0.12, foot],
  ];
  return `polygon(${pts.map(([x, y]) => `${px(x).toFixed(2)}% ${py(y).toFixed(2)}%`).join(", ")})`;
}

export interface ProjectionProps {
  /** The pulled slide, if any. */
  pulled: PageDef | undefined;
  /** The page on air (it does not project). */
  current: PageId | undefined;
  /** The lantern is lit (the daemon is not lost). */
  lit: boolean;
}

export function Projection({ pulled, current, lit }: ProjectionProps) {
  const on = projects(pulled, current, lit);
  // The last picture thrown stays in the gate while it fades out.
  const [shown, setShown] = useState<PageDef | undefined>(undefined);
  if (on && pulled !== shown) setShown(pulled);
  const picture = useRef<HTMLDivElement>(null);
  const beam = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const p = picture.current;
    const b = beam.current;
    if (!on || !p || !b || pulled === undefined) return;
    const glass = b.parentElement?.querySelector(`[data-slide="${pulled.id}"] > span`);
    if (!glass) return;
    const frame = requestAnimationFrame(() => {
      b.style.clipPath = beamPolygon(glass.getBoundingClientRect(), p.getBoundingClientRect(), b.getBoundingClientRect());
    });
    return () => cancelAnimationFrame(frame);
  }, [on, pulled]);

  return (
    <>
      <div ref={picture} className={styles.proj} data-flame data-projection={on ? shown?.id : undefined} aria-hidden="true">
        {shown && <Still key={shown.id} page={shown} className={styles.still} />}
      </div>
      <div ref={beam} className={styles.beam} data-beam={on || undefined} aria-hidden="true" />
    </>
  );
}
