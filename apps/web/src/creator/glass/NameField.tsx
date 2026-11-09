// The character's name under the glass, renamed in place, and Duplicate (perfection-pass task 7,
// requirement 7.3; the rules are library/variant.ts).
// - The name is a button; a press turns it into a field. Enter or leaving the field keeps the new
//   name, Esc puts the old one back (and is kept from the shell, which would leave the page). An
//   empty name is not kept: the old one stays and a note says why.
// - The house character keeps his name: no rename is offered (his name stays plain text), while
//   Duplicate is, and his variant may be renamed.
// - Duplicate writes the pending look first (the caller's onDuplicate), then makes the variant
//   active, so the variant carries what is on the glass.
import { memo, useRef, useState, type KeyboardEvent } from "react";
import { cleanName, NAME_MAX } from "../library/variant";
import styles from "./History.module.css";

export interface NameFieldProps {
  name: string;
  /** The house character: no rename. */
  fixed: boolean;
  onRename: (name: string) => Promise<unknown>;
  onDuplicate: () => Promise<unknown>;
}

/** Memoised (perfection-pass task 9): a look change leaves the name as it was. */
export const NameField = memo(function NameField({ name, fixed, onRename, onDuplicate }: NameFieldProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  // Enter closes the field, and a closing field may still blur: one edit is kept once.
  const open = useRef(false);
  const edit = (): void => {
    open.current = true;
    setEditing(true);
  };

  const commit = (value: string): void => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    const clean = cleanName(value);
    if (clean === undefined) return setNote("A character needs a name; the old one stays.");
    setNote(undefined);
    if (clean !== name) void onRename(clean).catch(() => setNote("The new name could not be kept."));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      open.current = false;
      setEditing(false);
    }
  };
  const duplicate = async (): Promise<void> => {
    setBusy(true);
    setNote(undefined);
    try {
      await onDuplicate();
    } catch {
      setNote("The variant could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={styles.name}>
      {fixed ? (
        <b title="The house character keeps his name">{name}</b>
      ) : editing ? (
        <input
          className={styles.field}
          aria-label="Character name"
          defaultValue={name}
          maxLength={NAME_MAX}
          // The field opens on a press of the name, so taking focus is what the person asked for.
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onKeyDown}
          onBlur={(event) => commit(event.currentTarget.value)}
          data-name-field=""
        />
      ) : (
        <button type="button" className={styles.rename} aria-label={`Rename ${name}`} title="Rename" onClick={edit}>
          {name}
        </button>
      )}
      <button type="button" className={styles.step} aria-label={`Duplicate ${name} as a variant`} title="Duplicate as a variant" aria-busy={busy} disabled={busy} onClick={() => void duplicate()}>
        Duplicate
      </button>
      {note !== undefined && (
        <span className={styles.note} role="status">
          {note}
        </span>
      )}
    </span>
  );
});
