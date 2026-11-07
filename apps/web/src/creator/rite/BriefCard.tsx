// The handshake card (cast-forge requirement 4.3): the brief the writer returned, laid out for
// approval inside mark I. The streamer may rename the character, rewrite its persona hook and its
// example lines (C4: up to three, what it says on air when no engine is live), rename its style,
// the eyes line (C3: "Its eyes are ...", what a face that is not human has for eyes; the live eye and
// expression edits are phrased in it; empty means human eyes, the field omitted),
// and change each planned part's role and motion or drop a part; "Draw it" starts the portrait from this brief
// (blocked while the edits break a rule, with the rule named), "Ask again" re-briefs from the words.
// A recorded brief carries the RECORDED tag. The accent swatch is the brief's own colour data.
// tiger L1: a part whose motion words name an event shows its signature act, read-only, under it.
import { actFromWords } from "@sr/forge/acts";
import { BRIEF_MAX_EXAMPLE_LINES, BRIEF_ROLES, parseBrief, type BriefError } from "@sr/forge/brief";
import type { BriefPart, CharacterBrief } from "@sr/forge/wire";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import marks from "./Marks.module.css";
import type { BriefState } from "./useBrief";
import styles from "./BriefCard.module.css";

/** The part's signature act as one read-only line ('on "sold"'), or nothing. */
function ActNote({ part }: { part: BriefPart }) {
  const act = actFromWords(part.name, part.role, part.motion);
  return act === undefined ? null : <small data-act={part.name}>signature act: on {act.cue.map((w) => `"${w}"`).join(" or ")}</small>;
}

export interface BriefCardProps {
  brief: CharacterBrief;
  recorded: boolean;
  /** The first rule the edited brief breaks; "Draw it" waits until it is fixed. */
  problem?: string;
  busy: boolean;
  onEdit: (brief: CharacterBrief) => void;
  onDraw: () => void;
  onAgain: () => void;
}

const FIELD: Readonly<Record<string, string>> = {
  "$.name": "The name",
  "$.persona_hook": "The hook",
  "$.example_lines": "The lines",
  "$.face": "The eyes line",
  "$.face.eyes": "The eyes line",
  "$.style.name": "The style",
  "$.parts": "The parts",
};

/** A parseBrief error in the card's words: the field (or part) and the rule. */
export function problemOf(brief: CharacterBrief, error: BriefError | undefined): string | undefined {
  if (error === undefined) return undefined;
  const line = /^\$\.example_lines\[(\d+)\]$/.exec(error.path);
  if (line?.[1] !== undefined) return `Line ${Number(line[1]) + 1} ${error.message}.`;
  const part = /^\$\.parts\[(\d+)\]\.?(\w*)/.exec(error.path);
  const who = part?.[1] === undefined ? (FIELD[error.path] ?? "The brief") : `${brief.parts[Number(part[1])]?.name ?? "A part"}${part[2] ? ` ${part[2]}` : ""}`;
  return `${who} ${error.message}.`;
}

/** A typed line break becomes a space: hook and lines are one line each. */
const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ");

/** The brief as parseBrief should see it: blank example lines are left out (a cleared slot is no line), a blank eyes line too. */
export function briefToCheck(brief: CharacterBrief): CharacterBrief {
  const { example_lines: raw, face, ...rest } = brief;
  const lines = (raw ?? []).filter((l) => l.trim() !== "");
  return { ...rest, ...(lines.length === 0 ? {} : { example_lines: lines }), ...(face === undefined || face.eyes.trim() === "" ? {} : { face }) };
}

/** The brief with its eyes line set; an empty line leaves the field out (human eyes). */
export function withEyes(brief: CharacterBrief, eyes: string): CharacterBrief {
  const rest: CharacterBrief = { ...brief };
  delete rest.face;
  return eyes.trim() === "" ? rest : { ...rest, face: { eyes } };
}

export function BriefCard({ brief, recorded, problem, busy, onEdit, onDraw, onAgain }: BriefCardProps) {
  const nameId = useId();
  const hookId = useId();
  const eyesId = useId();
  const styleId = useId();
  // The card arrives in view and in focus, so a keyboard or screen-reader user lands on it.
  const self = useRef<HTMLElement>(null);
  useEffect(() => self.current?.focus(), []);
  const setPart = (at: number, patch: Partial<BriefPart>) =>
    onEdit({ ...brief, parts: brief.parts.map((p, i) => (i === at ? { ...p, ...patch } : p)) });
  const setMotion = (at: number, motion: string) =>
    onEdit({
      ...brief,
      parts: brief.parts.map((p, i) => {
        if (i !== at) return p;
        return { name: p.name, role: p.role, what: p.what, ...(p.follow === undefined ? {} : { follow: p.follow }), ...(motion === "" ? {} : { motion }) };
      }),
    });
  // Three slots; a slot keeps its place while it is blank (briefToCheck drops it).
  const slots = Array.from({ length: BRIEF_MAX_EXAMPLE_LINES }, (_, i) => brief.example_lines?.[i] ?? "");
  const setLine = (at: number, text: string) => onEdit({ ...brief, example_lines: slots.map((l, i) => (i === at ? text : l)) });
  const lamp = { "--lamp": brief.accent_hex, "--lamp-2": brief.secondary_hex ?? brief.accent_hex } as CSSProperties;
  return (
    <section ref={self} tabIndex={-1} className={styles.card} aria-label="The brief" data-brief={recorded ? "recorded" : "live"}>
      <div className={styles.head}>
        <span className={styles.swatch} style={lamp} role="img" aria-label={`Accent ${brief.accent_hex}${brief.secondary_hex === undefined ? "" : `, secondary ${brief.secondary_hex}`}`} />
        <span className={styles.arch}>{brief.archetype}</span>
        {recorded && <span className={styles.tag}>RECORDED</span>}
      </div>
      <fieldset className={marks.fields} disabled={busy}>
        <label className={marks.lbl} htmlFor={nameId}>
          NAME
        </label>
        <input id={nameId} className={styles.input} value={brief.name} maxLength={80} spellCheck={false} onChange={(e) => onEdit({ ...brief, name: e.currentTarget.value })} />
        <label className={marks.lbl} htmlFor={hookId}>
          HOOK <small>who it is on air</small>
        </label>
        <textarea id={hookId} className={styles.say} value={brief.persona_hook} maxLength={480} rows={2} onChange={(e) => onEdit({ ...brief, persona_hook: oneLine(e.currentTarget.value) })} />
        <span className={marks.lbl}>
          LINES <small>what it says on air, up to {BRIEF_MAX_EXAMPLE_LINES}</small>
        </span>
        <div className={styles.lines} role="group" aria-label="Example lines">
          {slots.map((line, i) => (
            <textarea key={i} className={styles.say} aria-label={`Line ${i + 1}`} value={line} placeholder="a line in its own voice" maxLength={200} rows={1} onChange={(e) => setLine(i, oneLine(e.currentTarget.value))} />
          ))}
        </div>
        <label className={marks.lbl} htmlFor={eyesId}>
          EYES <small>what they are made of; empty for human eyes</small>
        </label>
        <div className={styles.eyes}>
          <span aria-hidden="true">Its eyes are</span>
          <textarea id={eyesId} className={styles.say} aria-label="Its eyes are" value={brief.face?.eyes ?? ""} placeholder="carved holes lit from inside" maxLength={280} rows={1} onChange={(e) => onEdit(withEyes(brief, oneLine(e.currentTarget.value)))} />
        </div>
        <label className={marks.lbl} htmlFor={styleId}>
          STYLE <small>its edges are the cut lines</small>
        </label>
        <input id={styleId} className={styles.input} value={brief.style.name} maxLength={80} spellCheck={false} onChange={(e) => onEdit({ ...brief, style: { ...brief.style, name: e.currentTarget.value } })} />
        <p className={styles.why}>
          {brief.style.why}
        </p>
        <span className={marks.lbl}>
          PARTS <small>{brief.parts.length} · role · motion</small>
        </span>
        <ol className={styles.parts} aria-label="Planned parts">
          {brief.parts.map((p, i) => (
            <li key={p.name} className={styles.part} data-role={p.role}>
              <span className={styles.pname}>
                <b>{p.name}</b>
                <small>{p.what}</small>
                <ActNote part={p} />
              </span>
              <button type="button" className={styles.drop} aria-label={`Drop ${p.name}`} onClick={() => onEdit({ ...brief, parts: brief.parts.filter((_, j) => j !== i) })}>
                ×
              </button>
              <select className={styles.role} aria-label={`${p.name} role`} value={p.role} onChange={(e) => setPart(i, { role: BRIEF_ROLES.find((r) => r === e.currentTarget.value) ?? p.role })}>
                {BRIEF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <textarea className={styles.motion} aria-label={`${p.name} motion`} value={p.motion ?? ""} placeholder="still" maxLength={200} rows={2} onChange={(e) => setMotion(i, e.currentTarget.value.replace(/\s*\n\s*/g, " "))} />
            </li>
          ))}
        </ol>
        {problem !== undefined && (
          <p className={styles.problem} role="status">
            {problem}
          </p>
        )}
        <div className={styles.keys}>
          <button type="button" className={marks.go} disabled={problem !== undefined} onClick={onDraw}>
            Draw it <small>{problem !== undefined ? "fix the brief" : recorded ? "recorded run" : "a real job"}</small>
          </button>
          <button type="button" className={marks.next} onClick={onAgain}>
            Ask again <small>{recorded ? "same recording" : "from your words"}</small>
          </button>
        </div>
      </fieldset>
    </section>
  );
}

export interface HandshakeProps {
  state: Exclude<BriefState, { phase: "idle" }>;
  busy: boolean;
  onEdit: (brief: CharacterBrief) => void;
  onDraw: (brief: CharacterBrief) => void;
  onAgain: () => void;
}

/** Mark I's handshake slot: the ask in flight, its failure (the words kept), or the card. */
export function Handshake({ state, busy, onEdit, onDraw, onAgain }: HandshakeProps) {
  if (state.phase === "asking") {
    return (
      <p className={styles.asking} role="status" data-brief="asking">
        The brief is being written…
      </p>
    );
  }
  if (state.phase === "failed") {
    return (
      <div className={marks.refuse} role="alert" data-failure={state.code}>
        <b>The brief did not come</b>
        {state.message}
        <span className={marks.why}>{state.code} · your words above are kept</span>
        <button type="button" className={marks.next} onClick={onAgain}>
          Ask again <small>the same words</small>
        </button>
      </div>
    );
  }
  const checked = parseBrief(briefToCheck(state.brief));
  const problem = checked.ok ? undefined : problemOf(state.brief, checked.errors[0]);
  return (
    <BriefCard
      brief={state.brief}
      recorded={state.plane === "replay"}
      {...(problem === undefined ? {} : { problem })}
      busy={busy}
      onEdit={onEdit}
      onDraw={() => checked.ok && onDraw(checked.value)}
      onAgain={onAgain}
    />
  );
}
