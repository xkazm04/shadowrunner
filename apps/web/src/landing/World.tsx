// The landing's one world (landing requirement 9.1). The scene is laid out in a fixed coordinate
// space and scaled as a unit to fit its stage: 1600x900 landscape, or 420x910 portrait when the
// stage is narrower than 0.78 (width / height). Children position themselves in world units
// (percentages of the world box) and read the layout from `[data-world]` and any empty band
// around the world from `[data-band]` on the stage.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import styles from "./World.module.css";

export type WorldLayout = "landscape" | "portrait";

export const WORLD_SIZE: Readonly<Record<WorldLayout, { width: number; height: number }>> = {
  landscape: { width: 1600, height: 900 },
  portrait: { width: 420, height: 910 },
};

/** Below this stage aspect (width / height) the portrait world is used. */
export const PORTRAIT_BELOW = 0.78;

/**
 * The status bar's block size in world px (StatusBar.module.css: 7.333% of 900, 10.55% of 910).
 * Portrait is two rows at most (landing task 5.0, R4-1-390x844-load.png).
 */
export const HEADER_HEIGHT: Readonly<Record<WorldLayout, number>> = { landscape: 66, portrait: 96 };

/** Top edge of the cabinet in the plate's px (superellipse.ts PLATE; the reference's plate mask). */
export const CABINET_TOP = 138;

export interface PlatePlacement {
  /** Plate px to world px. */
  scale: number;
  /** World position of the plate's top-left corner. */
  x: number;
  y: number;
}

/**
 * Where the set (task 5.2) stands: the reference's plate transforms. Both centre the plate on the
 * world (within 2 px); portrait maps plate (599, 135) to world (210, 118). Either way the cabinet
 * starts directly below the header: 7 world px in landscape, 22 in portrait.
 */
export const SET_PLATE: Readonly<Record<WorldLayout, PlatePlacement>> = {
  landscape: { scale: 1.09, x: 147, y: -77 },
  portrait: { scale: 0.53, x: 210 - 599 * 0.53, y: 118 - 135 * 0.53 },
};

export interface WorldFit {
  layout: WorldLayout;
  width: number;
  height: number;
  /** Uniform scale from world units to stage pixels. */
  scale: number;
  /** Offset of the scaled world inside the stage, centring it (letterbox or pillarbox). */
  x: number;
  y: number;
}

function finitePositive(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Pure: which world, at what scale and offset, fits a stage of `stageWidth` x `stageHeight`. */
export function fitWorld(stageWidth: number, stageHeight: number): WorldFit {
  const vw = finitePositive(stageWidth);
  const vh = finitePositive(stageHeight);
  const layout: WorldLayout = vh > 0 && vw / vh < PORTRAIT_BELOW ? "portrait" : "landscape";
  const { width, height } = WORLD_SIZE[layout];
  const scale = Math.min(vw / width, vh / height);
  return { layout, width, height, scale, x: (vw - width * scale) / 2, y: (vh - height * scale) / 2 };
}

export type WorldBand = "pillar" | "letter";

/**
 * Pure: whether the fitted world leaves empty bands on the stage (left and right: pillar; top and
 * bottom: letter), or none. Under half a pixel counts as none. The room shades the world's edges
 * into the stage only when there is a band, so the photo never ends in a hard line.
 */
export function bandOf(fit: Pick<WorldFit, "x" | "y">): WorldBand | undefined {
  if (fit.x > 0.5) return "pillar";
  if (fit.y > 0.5) return "letter";
  return undefined;
}

/** Before the stage is measured (server render, first client pass) the world sits at 1:1. */
const UNMEASURED = WORLD_SIZE.landscape;

function useStageSize(stage: RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState(UNMEASURED);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage]);
  return size;
}

export interface WorldProps {
  children?: ReactNode;
  /** Extra class for the stage, so the composition root can size it inside the shell. */
  className?: string;
}

export function World({ children, className }: WorldProps) {
  const stage = useRef<HTMLDivElement>(null);
  const size = useStageSize(stage);
  const fit = fitWorld(size.width, size.height);
  return (
    <div
      ref={stage}
      data-world={fit.layout}
      data-band={bandOf(fit)}
      className={className ? `${styles.stage} ${className}` : styles.stage}
    >
      <div
        className={styles.world}
        style={{
          width: fit.width,
          height: fit.height,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
