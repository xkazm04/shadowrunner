// The FORGE NEW sheet (creator requirement 3): describe a character or bring a picture, watch the
// staged progress, and land in a designed state for every failure code. The draft (text and
// picture) is owned by the page, so it survives tab switches and every failure keeps it for retry.
import type { ForgeErrorCode, ForgeRequest } from "@sr/forge/wire";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ForgeProgress } from "./ForgeProgress";
import type { ForgeJob } from "./useForgeJob";
import { ACCEPT_ATTR, browserCodec, prepareImage } from "./image";
import styles from "./Forge.module.css";

export const PROMPT_MIN = 10;
export const PROMPT_MAX = 500;

export interface ForgeDraft {
  prompt: string;
  image?: { base64: string; name: string; width: number; height: number };
}

export const EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Moth archivist", text: "A moth-winged archivist with violet eyes and dusty velvet robes, named Vesper" },
  { label: "Diving helmet", text: "An iron diving helmet that hums sea shanties, cold blue light behind the glass, named Brine" },
  { label: "Wax bishop", text: "A candle-wax bishop who melts when angry, a gold glow in his eyes, named Tallow" },
];

/** The request for a draft, or why it cannot be sent yet. A picture wins over the text. */
export function requestOf(draft: ForgeDraft): { ok: true; request: ForgeRequest } | { ok: false; message: string } {
  if (draft.image !== undefined) return { ok: true, request: { mode: "image", imageBase64: draft.image.base64 } };
  const prompt = draft.prompt.trim();
  if (prompt.length < PROMPT_MIN) return { ok: false, message: `Describe the character in at least ${PROMPT_MIN} characters.` };
  if (prompt.length > PROMPT_MAX) return { ok: false, message: `Keep the description under ${PROMPT_MAX} characters.` };
  return { ok: true, request: { mode: "prompt", prompt } };
}

interface FailureCopy {
  title: string;
  body: string;
}

export const FAILURE_COPY: Readonly<Record<ForgeErrorCode, FailureCopy>> = {
  quota: { title: "The forge is cold for tonight", body: "Tonight's budget for new faces is spent. The recorded characters are ready to adopt." },
  refused_likeness: {
    title: "No real people",
    body: "That picture looks like a real person. The forge only makes invented characters: bring a drawing, or describe someone who never lived.",
  },
  refused_content: { title: "The forge will not make that", body: "Change the description and try again. Dread is fine; gore and real harm are not." },
  upstream: { title: "The image model stopped answering", body: "Nothing was lost. Your description is still here; try again." },
  bad_input: { title: "The forge could not read that", body: "Check the field marked below and send it again." },
};

export interface ForgePanelProps {
  job: ForgeJob;
  draft: ForgeDraft;
  onDraft: (draft: ForgeDraft) => void;
  onOpenGallery: () => void;
  /** Shown after a job is done (the reveal and where the character went). */
  doneNote?: ReactNode;
}

export function ForgePanel({ job, draft, onDraft, onOpenGallery, doneNote }: ForgePanelProps) {
  const promptId = useId();
  const fileId = useId();
  const hintId = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const { state } = job;
  const busy = state.phase === "running" || job.starting;
  const ready = requestOf(draft);
  const failed = state.phase === "failed" ? state : undefined;
  const badField = failed?.code === "bad_input" ? (draft.image !== undefined ? "image" : "prompt") : undefined;

  // bad_input points at the field.
  useEffect(() => {
    if (badField === "prompt") promptRef.current?.focus();
    if (badField === "image") fileRef.current?.focus();
  }, [badField]);

  const send = (): void => {
    if (ready.ok) job.start(ready.request);
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    setImageError(undefined);
    if (file === undefined) return;
    setReading(true);
    const prepared = await prepareImage(file, browserCodec);
    setReading(false);
    if (!prepared.ok) {
      setImageError(prepared.message);
      return;
    }
    onDraft({ ...draft, image: { base64: prepared.base64, name: file.name, width: prepared.width, height: prepared.height } });
  };

  return (
    <div className={styles.forge}>
      {failed !== undefined && (
        <div className={styles.failure} role="alert" data-failure={failed.code}>
          <h3>{FAILURE_COPY[failed.code].title}</h3>
          <p>{FAILURE_COPY[failed.code].body}</p>
          {failed.message !== "" && <p className={styles.detail}>{failed.message}</p>}
          <div className={styles.buttons}>
            {failed.code === "quota" && (
              <button type="button" className={`${styles.button} ${styles.signal}`} onClick={onOpenGallery}>
                Open the replay gallery
              </button>
            )}
            {failed.code === "upstream" && (
              <button type="button" className={`${styles.button} ${styles.signal}`} onClick={() => job.start(failed.retry)}>
                Try again
              </button>
            )}
            <button type="button" className={styles.button} onClick={job.reset}>
              Edit and send again
            </button>
          </div>
        </div>
      )}

      {state.phase === "running" && <ForgeProgress status={state.status} elapsedMs={job.elapsedMs} />}
      {state.phase === "done" && doneNote !== undefined && (
        <div className={styles.done} role="status">
          {doneNote}
          <button type="button" className={styles.button} onClick={job.reset}>
            Forge another
          </button>
        </div>
      )}

      <form
        className={styles.form}
        aria-describedby={busy ? hintId : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <fieldset disabled={busy} className={styles.fieldset}>
          <section className={styles.row}>
            <label htmlFor={promptId} className={styles.heading}>
              Describe a character
            </label>
            <textarea
              id={promptId}
              ref={promptRef}
              className={styles.field}
              value={draft.prompt}
              maxLength={PROMPT_MAX + 100}
              rows={3}
              placeholder="e.g. a drowned lighthouse keeper with a lantern for a heart, violet light"
              aria-invalid={badField === "prompt" || undefined}
              onChange={(event) => onDraft({ ...draft, prompt: event.currentTarget.value })}
            />
            <div className={styles.meta}>
              <div className={styles.chips} role="group" aria-label="Examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex.label} type="button" className={styles.chip} onClick={() => onDraft({ ...draft, prompt: ex.text })}>
                    {ex.label}
                  </button>
                ))}
              </div>
              <span className={styles.count}>
                {draft.prompt.trim().length} / {PROMPT_MAX}
              </span>
            </div>
          </section>

          <section className={styles.row}>
            <label htmlFor={fileId} className={styles.heading}>
              Or bring a picture
            </label>
            {draft.image === undefined ? (
              <input
                id={fileId}
                ref={fileRef}
                type="file"
                accept={ACCEPT_ATTR}
                className={styles.file}
                aria-invalid={badField === "image" || imageError !== undefined || undefined}
                onChange={(event) => void onFile(event.currentTarget.files?.[0])}
              />
            ) : (
              <div className={styles.picked}>
                <span>
                  {draft.image.name} · {draft.image.width} × {draft.image.height}
                </span>
                <button type="button" className={styles.chip} onClick={() => onDraft({ prompt: draft.prompt })}>
                  Remove picture
                </button>
              </div>
            )}
            <p className={styles.note}>
              {reading ? "Reading the picture…" : (imageError ?? "PNG, JPEG or WebP up to 5 MB. Invented characters only, no real people.")}
            </p>
          </section>

          <div className={styles.buttons}>
            <button type="submit" className={`${styles.button} ${styles.signal}`} disabled={!ready.ok || busy}>
              Forge it
            </button>
            {!ready.ok && !busy && <span className={styles.note}>{ready.message}</span>}
          </div>
        </fieldset>
        {busy && (
          <p id={hintId} className={styles.note}>
            A forge is running for this tab. It keeps going if you leave the page; come back and it picks up where it is.
          </p>
        )}
      </form>
    </div>
  );
}
