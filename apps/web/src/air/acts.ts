// Signature acts on air (tiger L1, docs/rig-format.md "Act"): a spoken line that says an act's cue
// word fires that part's act once, timed to the word. Pure: which acts a rig carries (its own
// `Layer.act`, plus, for a recorded cast character, the acts compiled from its recorded brief at
// load time, castActs.ts), and where in a line the first cue word falls. Matching is at a word
// boundary, ignoring case, with simple endings (sold / Sold! / SOLD, ring / rings / ringing,
// count / counted). At most one act per line; the stage keeps ACT_COOLDOWN_MS between two.
import { ACT_KINDS, type LayerAct, type Rig } from "@sr/rig";

/** The least time between two acts on air. */
export const ACT_COOLDOWN_MS = 3_000;

/** An act the stage can fire: the layer and its cue words. */
export interface StageAct {
  layer: string;
  cue: readonly string[];
}

/** Where a line fires an act: the layer, the cue's character index and its fraction of the line. */
export interface LineCue {
  layer: string;
  index: number;
  /** `index / line.length`, in [0, 1). */
  at: number;
}

/** Every act the rig carries, in layer order. */
export function stageActs(rig: Rig): StageAct[] {
  return rig.layers.flatMap((l) => (l.act === undefined ? [] : [{ layer: l.name, cue: l.act.cue }]));
}

/**
 * The rig with `derived` acts set on the layers they name that may carry one and have none of
 * their own; the same rig object when nothing changes (a rig of its own acts, or no match).
 */
export function withActs(rig: Rig, derived: ReadonlyMap<string, LayerAct>): Rig {
  const takes = (name: string, kind: string, own: LayerAct | undefined) => own === undefined && derived.has(name) && ACT_KINDS.some((k) => k === kind);
  if (!rig.layers.some((l) => takes(l.name, l.kind, l.act))) return rig;
  const layers = rig.layers.map((l) => {
    const act = derived.get(l.name);
    return act !== undefined && takes(l.name, l.kind, l.act) ? { ...l, act } : l;
  });
  return { ...rig, layers };
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** A cue word as a pattern: the word, its last letter maybe doubled, and a simple ending. */
export function cuePattern(word: string): RegExp {
  const last = escape(word.at(-1) ?? "");
  return new RegExp(`\\b${escape(word)}${last}?(?:s|es|d|ed|ing|er|ers)?\\b`, "i");
}

/** The first cue word the line says, over every act; undefined when it says none. */
export function lineCue(line: string, acts: readonly StageAct[]): LineCue | undefined {
  let best: LineCue | undefined;
  for (const act of acts) {
    for (const word of act.cue) {
      const index = cuePattern(word).exec(line)?.index;
      if (index !== undefined && (best === undefined || index < best.index)) best = { layer: act.layer, index, at: index / line.length };
    }
  }
  return best;
}

/** Whether an act may fire at `now` after the last one at `last` (ms on one clock). */
export const cooled = (last: number | undefined, now: number): boolean => last === undefined || now - last >= ACT_COOLDOWN_MS;
