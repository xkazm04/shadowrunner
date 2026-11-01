// CH 4 Cellar Listings as the wall of sets (costume requirement 5, after `r1/characters-c.html`
// "The Wall of Sets"): a junk-shop wall of stacked televisions on shelves, one face per hour.
// The sets power on in schedule order (dot, line, picture), Malakor's big set last, then the
// ON AIR sign lights. Hovering or focusing a set warms its tube and throws that character's colour
// across the brick; clicking it pins its listing to the newspaper clipping, with its Forge and
// Watch actions. The vacant hour hisses with static; channel 9 is taped over.
//
// The cast is the creator's (the recorded forge jobs + the preset notes), loaded as its own chunk
// after the page; the live hour's tube is the renderer, also its own chunk (WallLive). Pointer
// effects (the colour spill, where Malakor looks) write CSS variables and a ref, never a render.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LookAtPoint, LookAtRef } from "@sr/avatar";
import castStill from "../../../../assets/replay/thumbs/malakor.webp";
import type { GalleryEntry } from "../creator/gallery/entries";
import styles from "./Listings.module.css";
import { bootTimeline, wallSets, type WallSet as WallSetData } from "./ListingsWall";
import { channelOf, WallClipping, type HouseListing } from "./WallClipping";
import { WallSet } from "./WallSet";

export { forgePathFor } from "./WallClipping";
export { hourAfter } from "./ListingsWall";

/** What the listings show of a cast member. */
export type ListedCharacter = Pick<GalleryEntry, "id" | "slug" | "name" | "portraitUrl" | "hook" | "teaches" | "showsOff" | "origin">;

/** The live tube, given where to look and whether the set is speaking yet. */
export type LiveTube = (props: { lookAt: LookAtRef; speaking: boolean }) => ReactNode;

export interface ListingsProps {
  /** The cast, house character included. Default: the creator's cast, as a lazy chunk. */
  loadCast?: () => Promise<readonly ListedCharacter[]>;
  /** The big set's live tube. Default: <AvatarCanvas> in its own chunk. */
  liveTube?: LiveTube;
}

const loadCommittedCast = (): Promise<readonly ListedCharacter[]> => import("../creator/gallery/entries").then((m) => m.loadCast());

const WallLive = lazy(() => import("./WallLive"));
const lazyLiveTube: LiveTube = (props) => (
  <Suspense fallback={null}>
    <WallLive {...props} />
  </Suspense>
);

/** The house character's id: he is on now, written from his bible below. */
export const ON_NOW_ID = "malakor";

/** Him, when the cast does not come through: his set stays on the wall. */
const HOUSE: ListedCharacter = { id: ON_NOW_ID, slug: ON_NOW_ID, name: "Arch-Lich Malakor", origin: "hand-rigged" };

/** The listing card's facts, as the reference's definition list. */
export const MALAKOR_FACTS: readonly (readonly [string, string])[] = [
  ["Rig", "18 layers · bone, verdigris, eleven crown shards"],
  ["Voice", "Vault Baritone"],
  ["Moves", "10 emotions · 6 gestures"],
  ["Segments", "Audience Chamber · The Investigation · Table Read"],
];

const HOUSE_LISTING: Omit<HouseListing, "facts"> = {
  epithet: "High Auditor of the Obsidian Spire, a lich of the Ninth Dark",
  blurb:
    "Eleven centuries dead and still under-budgeted, he streams because the Ninth Dark now conquers by audience. He holds court, audits rival schemers from public records, and keeps a ledger of every regular.",
};

const CHANNELS = { live: channelOf("landing") ?? 2, later: channelOf("creator") ?? 3, sealed: channelOf("sealed") ?? 9 };

/** dark: the cast is still tuning in; boot: the tubes power on; lit: ON AIR; idle: the wall is awake. */
type Phase = "dark" | "boot" | "lit" | "idle";

const SWAP_MS = 220;

const reducedMotion = (): boolean => typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

type Slot = WallSetData<ListedCharacter>;

export function Listings({ loadCast = loadCommittedCast, liveTube = lazyLiveTube }: ListingsProps) {
  const [cast, setCast] = useState<readonly ListedCharacter[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>("dark");
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [shown, setShown] = useState<string | undefined>(undefined);
  const [changing, setChanging] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const wallRef = useRef<HTMLElement>(null);
  const lookAt = useRef<LookAtPoint | null>(null);

  useEffect(() => {
    let live = true;
    loadCast().then(
      (list) => live && setCast(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [loadCast]);

  const sets = useMemo(() => wallSets(cast ?? [], ON_NOW_ID, CHANNELS, HOUSE), [cast]);
  const ready = cast !== undefined || failed;
  const house = sets.find((s) => s.kind === "live");
  const chosenKey = chosen ?? house?.key;
  const shownSet = sets.find((s) => s.key === (shown ?? chosenKey)) ?? house;
  const facts = useMemo(() => {
    const showsOff = house?.member?.showsOff;
    return showsOff === undefined ? MALAKOR_FACTS : [...MALAKOR_FACTS, ["Shows off", showsOff] as const];
  }, [house]);

  // The boot: once the cast is in, the tubes wake in schedule order, then ON AIR, then idle.
  useEffect(() => {
    if (!ready) return undefined;
    if (reducedMotion()) {
      setPhase("idle");
      return undefined;
    }
    const { litMs, idleMs } = bootTimeline(sets);
    setPhase("boot");
    const lit = window.setTimeout(() => setPhase("lit"), litMs);
    const idle = window.setTimeout(() => setPhase("idle"), idleMs);
    return () => {
      window.clearTimeout(lit);
      window.clearTimeout(idle);
    };
  }, [ready, sets]);

  /** Throw `set`'s colour across the brick from where it hangs, and turn Malakor toward it. */
  const spillTo = useCallback((el: Element | null | undefined, set: Slot | undefined) => {
    const page = pageRef.current;
    if (page === null || el === null || el === undefined || set === undefined) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    page.style.setProperty("--wall-sx", `${((cx / window.innerWidth) * 100).toFixed(1)}%`);
    page.style.setProperty("--wall-sy", `${((cy / window.innerHeight) * 100).toFixed(1)}%`);
    page.style.setProperty("--wall-sc", `var(--sr-${set.accent})`);
    page.style.setProperty("--wall-sa", `${Math.round(set.spill * 100)}%`);
    const tube = wallRef.current?.querySelector('[data-kind="live"]')?.getBoundingClientRect();
    lookAt.current =
      set.kind === "live" || tube === undefined || tube.width === 0
        ? null
        : { x: (2 * (cx - tube.left)) / tube.width - 1, y: (2 * (cy - tube.top)) / tube.height - 1 };
  }, []);

  const setEl = useCallback((key: string | undefined) => (key === undefined ? null : wallRef.current?.querySelector(`[data-set="${CSS.escape(key)}"]`)), []);

  const lit = phase === "lit" || phase === "idle";
  // The chosen set's colour holds the room once ON AIR is lit (and whenever the choice moves).
  useEffect(() => {
    if (!lit) return undefined;
    const settle = (): void => spillTo(setEl(chosenKey), sets.find((s) => s.key === chosenKey));
    settle();
    window.addEventListener("resize", settle);
    return () => window.removeEventListener("resize", settle);
  }, [lit, chosenKey, sets, spillTo, setEl]);

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const choose = useCallback((set: Slot) => {
    setChosen(set.key);
    window.clearTimeout(timer.current);
    if (reducedMotion()) {
      setShown(set.key);
      return;
    }
    setChanging(true);
    timer.current = window.setTimeout(() => {
      setShown(set.key);
      setChanging(false);
    }, SWAP_MS);
  }, []);

  const warm = useCallback((el: HTMLElement, set: Slot) => spillTo(el, set), [spillTo]);
  const cool = useCallback(() => {
    if (lit) spillTo(setEl(chosenKey), sets.find((s) => s.key === chosenKey));
  }, [lit, chosenKey, sets, spillTo, setEl]);

  const rows = Math.max(3, Math.ceil((sets.length - 1 + 1 + 4) / 4));

  return (
    <article ref={pageRef} className={styles.page} data-page="characters" data-phase={phase} aria-labelledby="page-title">
      <div className={styles.room} aria-hidden="true" />
      <div className={styles.spill} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <h1 id="page-title" className={styles.title}>
        <span>Cellar Listings</span> · all night · channels {CHANNELS.live} to {CHANNELS.sealed} · characters who stream
      </h1>
      <section ref={wallRef} className={styles.wall} aria-label="Tonight's sets, one face per hour" aria-busy={!ready}>
        {Array.from({ length: rows - 1 }, (_, i) => (
          <span key={i} className={styles.shelf} style={{ gridRow: `${i + 1} / span 1` }} aria-hidden="true" />
        ))}
        {(ready ? sets : sets.filter((s) => s.kind === "live")).map((set) => (
          <WallSet
            key={set.key}
            set={set}
            pressed={set.key === chosenKey}
            liveChannel={CHANNELS.live}
            liveStill={house?.member?.portraitUrl ?? castStill}
            liveTube={set.kind === "live" ? liveTube({ lookAt, speaking: lit }) : undefined}
            onChoose={choose}
            onWarm={warm}
            onCool={cool}
          />
        ))}
      </section>
      <WallClipping set={shownSet} house={{ ...HOUSE_LISTING, facts }} changing={changing} failed={failed} />
    </article>
  );
}
