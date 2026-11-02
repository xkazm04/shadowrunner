// The rite's four marks (costume 3.2, `r2/creator-a.html` `.rite`): Describe, Bind, Forge, Wake,
// each a card with a wax seal that is dark (next), lit (now) or pressed (done). One is open at a
// time: the one the rite stands at, unless the visitor opens another. This file holds the frame and
// the first two marks' bodies; ForgeWake.tsx the last two.
import { VOICE_IDS, VOICES } from "@sr/engine";
import type { ForgeErrorCode } from "@sr/forge/wire";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ACCEPT_ATTR, browserCodec, prepareImage } from "../forge/image";
import { MARKS, type Mark } from "./riteClock";
import { ARCHETYPES, EXAMPLES, FAILURE_COPY, PALETTES, PROMPT_MAX, type Bind, type ForgeDraft } from "./request";
import styles from "./Marks.module.css";

export interface MarksProps {
  at: Mark;
  open: Mark;
  onOpen: (mark: Mark) => void;
  summaries: readonly [string, string, string, string];
  bodies: readonly [ReactNode, ReactNode, ReactNode, ReactNode];
}

export function Marks({ at, open, onOpen, summaries, bodies }: MarksProps) {
  return (
    <ol className={styles.rite}>
      {MARKS.map((m, i) => {
        const state = i < at || (at === 3 && i === 3) ? "done" : i === at ? "now" : "next";
        const isOpen = i === open;
        return (
          <li key={m.name} className={styles.mark} data-state={state} data-open={isOpen ? "" : undefined}>
            <button type="button" className={styles.markHead} aria-expanded={isOpen} aria-controls={`mark-${i}`} onClick={() => onOpen(i as Mark)}>
              <span className={styles.seal} aria-hidden="true">
                {m.numeral}
              </span>
              <span className={styles.markName}>
                <b>{m.name}</b>
                {!isOpen && <span className={styles.sum}>{summaries[i]}</span>}
              </span>
              <span className={styles.markState}>{state === "done" ? "DONE" : state === "now" ? "NOW" : "NEXT"}</span>
            </button>
            {isOpen && (
              <div className={styles.markBody} id={`mark-${i}`}>
                {bodies[i]}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface DescribeProps {
  draft: ForgeDraft;
  onDraft: (draft: ForgeDraft) => void;
  busy: boolean;
  /** A failure that is about the description (likeness, content, input). */
  refusal?: { code: ForgeErrorCode; message: string };
  /** Replay only: forge the recorded refusal of a real face. */
  onTryRealFace?: () => void;
  onNext: () => void;
  /** Why the description cannot go on yet. */
  blocked?: string;
  /** cast-forge 4.3: ask for a brief from the words (offered while there is no picture). */
  onBrief?: () => void;
  /** Why the words cannot be briefed yet. */
  briefBlocked?: string;
  /** The handshake: the brief card, or the ask in flight, or its failure. */
  brief?: ReactNode;
}

export function Describe({ draft, onDraft, busy, refusal, onTryRealFace, onNext, blocked, onBrief, briefBlocked, brief }: DescribeProps) {
  const promptId = useId();
  const fileId = useId();
  const [reading, setReading] = useState(false);
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const onFile = async (picked: File | undefined): Promise<void> => {
    setImageError(undefined);
    if (picked === undefined) return;
    setReading(true);
    const prepared = await prepareImage(picked, browserCodec);
    setReading(false);
    if (!prepared.ok) setImageError(prepared.message);
    else onDraft({ ...draft, image: { base64: prepared.base64, name: picked.name, width: prepared.width, height: prepared.height } });
  };
  return (
    <fieldset className={styles.fields} disabled={busy}>
      <label className={styles.lbl} htmlFor={promptId}>
        IN WORDS{" "}
        <small>
          {draft.prompt.trim().length} / {PROMPT_MAX}
        </small>
      </label>
      <textarea
        id={promptId}
        className={styles.prompt}
        rows={5}
        maxLength={PROMPT_MAX + 100}
        spellCheck={false}
        value={draft.prompt}
        placeholder="e.g. a drowned lighthouse keeper with a lantern for a heart, violet light"
        aria-invalid={refusal?.code === "bad_input" && draft.image === undefined ? true : undefined}
        onChange={(event) => onDraft({ ...draft, prompt: event.currentTarget.value })}
      />
      {/* With a brief on the table the examples and the drawing step aside, so the card fits. */}
      {brief === undefined && (
        <>
          <span className={styles.lbl}>OR START FROM</span>
          <div className={styles.chips} role="group" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" onClick={() => onDraft({ ...draft, prompt: ex.text })}>
                {ex.label}
              </button>
            ))}
          </div>
          <div className={styles.drop}>
            {draft.image === undefined ? (
              <label className={styles.dropKey} htmlFor={fileId}>
                {reading ? "Reading the drawing…" : "Bring a drawing"}
                <small>{imageError ?? "png · jpg · webp up to 5 MB"}</small>
                <input id={fileId} className={styles.file} type="file" accept={ACCEPT_ATTR} onChange={(event) => void onFile(event.currentTarget.files?.[0])} />
              </label>
            ) : (
              <button type="button" className={styles.dropKey} onClick={() => onDraft({ prompt: draft.prompt })}>
                {draft.image.name}
                <small>
                  {draft.image.width} × {draft.image.height} · press to remove
                </small>
              </button>
            )}
            {onTryRealFace !== undefined && (
              <button type="button" className={styles.dropKey} onClick={onTryRealFace}>
                A photo of a real face?
                <small>see what happens</small>
              </button>
            )}
          </div>
        </>
      )}
      {refusal !== undefined && (
        <div className={styles.refuse} role="alert" data-failure={refusal.code}>
          <b>{FAILURE_COPY[refusal.code].title}</b>
          {FAILURE_COPY[refusal.code].body}
          <span className={styles.why}>
            {refusal.code} · {refusal.message} · your words above are kept
          </span>
        </div>
      )}
      {brief ??
        (onBrief !== undefined && draft.image === undefined && (
          <button type="button" className={styles.next} disabled={briefBlocked !== undefined} onClick={onBrief}>
            Brief it <small>{briefBlocked ?? "a character brief to approve"}</small>
          </button>
        ))}
      <button type="button" className={styles.next} disabled={blocked !== undefined} onClick={onNext}>
        Bind it <small>{blocked ?? "archetype · voice · palette"}</small>
      </button>
    </fieldset>
  );
}

export interface BindProps {
  bind: Bind;
  onBind: (bind: Bind) => void;
  busy: boolean;
  recorded: boolean;
  onForge: () => void;
  blocked?: string;
}

function Chips({ label, items, at, onPick, swatches }: { label: string; items: readonly string[]; at?: number; onPick: (i: number | undefined) => void; swatches?: readonly (readonly [string, string, string])[] }) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {items.map((item, i) => {
        const sw = swatches?.[i];
        return (
          <button key={item} type="button" aria-pressed={at === i} onClick={() => onPick(at === i ? undefined : i)} className={sw === undefined ? undefined : styles.sw}>
            {sw !== undefined && <i aria-hidden="true" style={{ "--lamp": sw[1], "--lamp-2": sw[2] } as CSSProperties} />}
            {item}
          </button>
        );
      })}
    </div>
  );
}

/** `bind` with `key` set to `value`, or without `key` when `value` is undefined (omitted, never undefined). */
const drop = <K extends keyof Bind>(bind: Bind, key: K, value: Bind[K] | undefined): Bind => {
  const rest = Object.fromEntries(Object.entries(bind).filter(([k]) => k !== key)) as Bind;
  return value === undefined ? rest : { ...rest, [key]: value };
};

export function BindMark({ bind, onBind, busy, recorded, onForge, blocked }: BindProps) {
  const voiceAt = bind.voice === undefined ? undefined : VOICE_IDS.indexOf(bind.voice);
  return (
    <fieldset className={styles.fields} disabled={busy}>
      <span className={styles.lbl}>
        ARCHETYPE <small>read with the description</small>
      </span>
      <Chips label="Archetype" items={ARCHETYPES} {...(bind.archetype === undefined ? {} : { at: bind.archetype })} onPick={(i) => onBind(drop(bind, "archetype", i))} />
      <span className={styles.lbl}>VOICE</span>
      <Chips
        label="Voice"
        items={VOICE_IDS.map((id) => VOICES[id].label.split(":")[0] ?? id)}
        {...(voiceAt === undefined ? {} : { at: voiceAt })}
        onPick={(i) => onBind(drop(bind, "voice", i === undefined ? undefined : VOICE_IDS[i]))}
      />
      <p className={styles.vdesc}>{bind.voice === undefined ? " " : VOICES[bind.voice].label.split(":")[1]?.trim()}</p>
      <span className={styles.lbl}>
        PALETTE <small>eye · glow</small>
      </span>
      <Chips label="Palette" items={PALETTES.map((p) => p[0])} swatches={PALETTES} {...(bind.palette === undefined ? {} : { at: bind.palette })} onPick={(i) => onBind(drop(bind, "palette", i))} />
      <p className={styles.note}>Chosen before the forge, so the face wakes already lit and voiced.</p>
      <button type="button" className={styles.go} disabled={blocked !== undefined} onClick={onForge}>
        Forge it <small>{blocked ?? (recorded ? "recorded run" : "a real job")}</small>
      </button>
    </fieldset>
  );
}
