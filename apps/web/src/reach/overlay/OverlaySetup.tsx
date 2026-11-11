// /overlay without a source (spec avatar-reach, requirement 3.5): a small card that builds the URL
// to paste into OBS - a character (cast pack or this browser's library), the background, the
// microphone - with a copy button, the keys, and how to let OBS use the microphone.
import { useEffect, useState, type ReactElement } from "react";
import type { Plane } from "../../app/plane";
import { openLibrary } from "../../creator/library/libraryStore";
import { loadCastIndex } from "../playable";
import { MOOD_KEYS, GESTURE_KEY, OVERLAY_GESTURE } from "./keys";
import { buildOverlayUrl, CHROMA_GREEN, type OverlayBackground, type OverlaySource } from "./params";
import styles from "./OverlaySetup.module.css";

export const OBS_MIC_NOTE =
  "OBS Browser Source cannot ask for the microphone: start OBS with --enable-media-stream, or use Window Capture on this page in a browser.";
export const LIBRARY_NOTE = "A library character lives in this browser only: OBS's own browser cannot see it, so use Window Capture or a cast pack.";

interface Choice {
  value: string;
  label: string;
  source: OverlaySource;
  /** companion-lanes: listed under "Companions", after the cast. */
  companion?: true;
}

type BgChoice = "transparent" | "green" | "colour";

const PACK_EXTENSION = /\.srpack$/;

/** The setup's own URL builder: the select value (`pack:<slug>` / `character:<id>`) to a source. */
export function sourceOfChoice(value: string): OverlaySource | undefined {
  const at = value.indexOf(":");
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (at < 0 || id === "") return undefined;
  if (kind === "pack") return { pack: id };
  if (kind === "character") return { character: id };
  return undefined;
}

function useChoices(): { cast: Choice[]; library: Choice[]; loaded: boolean } {
  const [cast, setCast] = useState<Choice[]>([]);
  const [library, setLibrary] = useState<Choice[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const castLoad = loadCastIndex({ signal: abort.signal }).then((entries) =>
      entries.map((entry) => {
        const slug = entry.file.replace(PACK_EXTENSION, "");
        return { value: `pack:${slug}`, label: entry.name, source: { pack: slug }, ...(entry.companion === true ? { companion: true as const } : {}) };
      }),
    );
    const libraryLoad = openLibrary()
      .then((store) => store.list())
      .then((entries) =>
        entries.flatMap((entry) =>
          entry.kind === "ok" ? [{ value: `character:${entry.record.id}`, label: entry.record.rig.name, source: { character: entry.record.id } }] : [],
        ),
      )
      .catch(() => []);
    void Promise.all([castLoad, libraryLoad]).then(([c, l]) => {
      if (abort.signal.aborted) return;
      setCast(c);
      setLibrary(l);
      setLoaded(true);
    });
    return () => abort.abort();
  }, []);
  return { cast, library, loaded };
}

const MOOD_HELP = `${Object.keys(MOOD_KEYS)
  .filter((key) => key !== "0")
  .map((key) => `${key} ${MOOD_KEYS[key]}`)
  .join(", ")}; 0 neutral; ${GESTURE_KEY.toUpperCase()} ${OVERLAY_GESTURE}. Esc leaves.`;

export interface OverlaySetupProps {
  plane: Plane;
  /** Defaults to this page's origin. */
  origin?: string;
}

export function OverlaySetup({ plane, origin = window.location.origin }: OverlaySetupProps): ReactElement {
  const { cast, library, loaded } = useChoices();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [bgChoice, setBgChoice] = useState<BgChoice>("transparent");
  const [colour, setColour] = useState(CHROMA_GREEN);
  const [mic, setMic] = useState(true);
  const [copied, setCopied] = useState<string | undefined>(undefined);

  const value = picked ?? cast[0]?.value ?? library[0]?.value ?? "";
  const source = sourceOfChoice(value);
  const bg: OverlayBackground = bgChoice === "colour" ? (colour.toLowerCase() as `#${string}`) : bgChoice;
  const url = source === undefined ? undefined : buildOverlayUrl(origin, { source, bg, mic });
  const fromLibrary = source !== undefined && "character" in source;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied.");
    } catch {
      setCopied("Select the address and copy it.");
    }
  }

  return (
    <section data-page="overlay" data-plane={plane} aria-label="Overlay" className={styles.page}>
      <form className={styles.card} onSubmit={(event) => event.preventDefault()}>
        <h1 className={styles.title}>Overlay</h1>
        <p className={styles.lede}>A character for OBS: paste the address below into a Browser Source.</p>

        <label className={styles.field}>
          <span>Character</span>
          <select
            value={value}
            disabled={!loaded || (cast.length === 0 && library.length === 0)}
            onChange={(event) => {
              setPicked(event.target.value);
              setCopied(undefined);
            }}
          >
            {!loaded && <option value="">Loading the cast.</option>}
            {loaded && cast.length === 0 && library.length === 0 && <option value="">No characters found.</option>}
            {(
              [
                ["Cast", cast.filter((c) => c.companion !== true)],
                ["Companions", cast.filter((c) => c.companion === true)],
              ] satisfies [string, Choice[]][]
            ).map(([label, group]) =>
              group.length === 0 ? null : (
                <optgroup key={label} label={label}>
                  {group.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
            {library.length > 0 && (
              <optgroup label="Your library">
                {library.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {fromLibrary && <p className={styles.note}>{LIBRARY_NOTE}</p>}

        <fieldset className={styles.field}>
          <legend>Background</legend>
          {(
            [
              ["transparent", "Transparent"],
              ["green", "Chroma green"],
              ["colour", "Colour"],
            ] as const
          ).map(([choice, label]) => (
            <label key={choice} className={styles.option}>
              <input type="radio" name="bg" value={choice} checked={bgChoice === choice} onChange={() => setBgChoice(choice)} />
              {label}
            </label>
          ))}
          {bgChoice === "colour" && (
            <input type="color" aria-label="Background colour" value={colour} onChange={(event) => setColour(event.target.value)} />
          )}
        </fieldset>

        <label className={styles.option}>
          <input type="checkbox" checked={mic} onChange={(event) => setMic(event.target.checked)} />
          Lip-sync to the microphone
        </label>
        {mic && <p className={styles.note}>{OBS_MIC_NOTE}</p>}

        <label className={styles.field}>
          <span>Address</span>
          <input type="text" readOnly value={url ?? ""} onFocus={(event) => event.target.select()} />
        </label>
        <div className={styles.actions}>
          <button type="button" disabled={url === undefined} onClick={() => url !== undefined && void copy(url)}>
            Copy
          </button>
          {url !== undefined && (
            <a href={url} target="_blank" rel="noreferrer">
              Open the overlay
            </a>
          )}
          <span role="status">{copied}</span>
        </div>
        <p className={styles.note}>Keys in the overlay: {MOOD_HELP}</p>
      </form>
    </section>
  );
}
