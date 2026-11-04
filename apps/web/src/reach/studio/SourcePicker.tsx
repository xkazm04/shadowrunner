// The studio's character picker (requirement 4.1): a cast pack, a character from this browser's
// library, or an uploaded .srpack. The lists load once; the library list holds only readable
// records (a damaged one cannot play).
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { openLibrary } from "../../creator/library/libraryStore";
import { loadCastIndex, type CastEntry, type PlayableSource } from "../playable";
import styles from "./Studio.module.css";

export interface Choice {
  id: string;
  name: string;
}

/** Library characters this browser can play, oldest first; [] when the library cannot open. */
export async function libraryChoices(): Promise<Choice[]> {
  try {
    const entries = await (await openLibrary()).list();
    return entries.flatMap((entry) => (entry.kind === "ok" ? [{ id: entry.record.id, name: entry.record.rig.name }] : []));
  } catch {
    return [];
  }
}

/** The source for a cast index entry: its pack file under /packs/. */
export function castSource(entry: CastEntry): PlayableSource {
  return { pack: `/packs/${entry.file}` };
}

export interface SourcePickerProps {
  /** The key of the source picked now (`cast:<id>`, `lib:<id>`, `file`). Undefined: the first cast pack is picked once the cast loads. */
  current: string | undefined;
  onPick(key: string, source: PlayableSource): void;
  busy: boolean;
}

export function SourcePicker({ current, onPick, busy }: SourcePickerProps): ReactElement {
  const [cast, setCast] = useState<CastEntry[] | undefined>(undefined);
  const [library, setLibrary] = useState<Choice[] | undefined>(undefined);
  const latest = useRef({ current, onPick });
  useEffect(() => {
    latest.current = { current, onPick };
  });

  useEffect(() => {
    const abort = new AbortController();
    void loadCastIndex({ signal: abort.signal }).then((list) => {
      if (abort.signal.aborted) return;
      setCast(list);
      const first = list[0];
      if (first !== undefined && latest.current.current === undefined) latest.current.onPick(`cast:${first.id}`, castSource(first));
    });
    void libraryChoices().then((list) => {
      if (!abort.signal.aborted) setLibrary(list);
    });
    return () => abort.abort();
  }, []);

  const pickCast = (event: ChangeEvent<HTMLSelectElement>) => {
    const entry = cast?.find((e) => e.id === event.target.value);
    if (entry !== undefined) onPick(`cast:${entry.id}`, castSource(entry));
  };
  const pickLibrary = (event: ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value;
    if (id !== "") onPick(`lib:${id}`, { character: id });
  };
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file !== undefined) onPick("file", { file });
    event.target.value = "";
  };
  const value = (prefix: string) => (current?.startsWith(prefix) ? current.slice(prefix.length) : "");

  return (
    <fieldset className={styles.group} disabled={busy}>
      <legend className={styles.legend}>Character</legend>
      <label className={styles.field}>
        <span>Cast</span>
        <select value={value("cast:")} onChange={pickCast} disabled={cast === undefined || cast.length === 0}>
          <option value="">{cast === undefined ? "Loading the cast…" : cast.length === 0 ? "No cast packs here" : "Pick a cast member"}</option>
          {cast?.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Your library</span>
        <select value={value("lib:")} onChange={pickLibrary} disabled={library === undefined || library.length === 0}>
          <option value="">{library === undefined ? "Opening the library…" : library.length === 0 ? "Nothing in this browser yet" : "Pick a character"}</option>
          {library?.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>A pack file</span>
        <input type="file" accept=".srpack" onChange={upload} />
      </label>
    </fieldset>
  );
}
