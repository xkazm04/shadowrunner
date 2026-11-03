// The handshake card (cast-forge requirement 4.3): the brief the writer returned, laid out for
// approval inside mark I. The streamer may rename the character, rename its style, and change each
// planned part's role and motion or drop a part; "Draw it" starts the portrait from this brief
// (blocked while the edits break a rule, with the rule named), "Ask again" re-briefs from the words.
// A recorded brief carries the RECORDED tag. The accent swatch is the brief's own colour data.
import { BRIEF_ROLES, parseBrief, type BriefError } from "@sr/forge/brief";
import type { BriefPart, CharacterBrief } from "@sr/forge/wire";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import marks from "./Marks.module.css";
import type { BriefState } from "./useBrief";
import styles from "./BriefCard.module.css";

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
  "$.style.name": "The style",
  "$.parts": "The parts",
};

/** A parseBrief error in the card's words: the field (or part) and the rule. */
export function problemOf(brief: CharacterBrief, error: BriefError | undefined): string | undefined {
  if (error === undefined) return undefined;
  const part = /^\$\.parts\[(\d+)\]\.?(\w*)/.exec(error.path);
  const who = part?.[1] === undefined ? (FIELD[error.path] ?? "The brief") : `${brief.parts[Number(part[1])]?.name ?? "A part"}${part[2] ? ` ${part[2]}` : ""}`;
  return `${who} ${error.message}.`;
}

export function BriefCard({ brief, recorded, problem, busy, onEdit, onDraw, onAgain }: BriefCardProps) {
  const nameId = useId();
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
        <p className={styles.hook} title={brief.persona_hook}>
          {brief.persona_hook}
        </p>
        <label className={marks.lbl} htmlFor={styleId}>
          STYLE <small>its edges are the cut lines</small>
        </label>
        <input id={styleId} className={styles.input} value={brief.style.name} maxLength={80} spellCheck={false} onChange={(e) => onEdit({ ...brief, style: { ...brief.style, name: e.currentTarget.value } })} />
        <p className={styles.why} title={brief.style.why}>
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
              <input className={styles.motion} aria-label={`${p.name} motion`} value={p.motion ?? ""} placeholder="still" maxLength={200} onChange={(e) => setMotion(i, e.currentTarget.value)} />
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
  const checked = parseBrief(state.brief);
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
