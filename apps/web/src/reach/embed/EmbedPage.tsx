// /embed (spec avatar-reach, design "Embed"): the <sr-avatar> element live on a cast pack, a pack
// picker, mood keys and the snippet to paste into another site.
//
// Decisions the spec leaves open:
// - The live example is the same element the script defines, created imperatively (no JSX typing
//   for a custom tag); the page only sets its attributes and calls its API.
// - "As saved" (no `mood` attribute) is the default mood, so the snippet stays minimal.
// - Copy uses the Clipboard API; where it is refused the snippet stays selectable and a sentence says so.
import { EMOTION_TABLE, type Emotion } from "@sr/rig";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Plane } from "../../app/plane";
import { castSlugOf, loadCastIndex, packUrlOf, type CastEntry } from "../playable";
import { embedSnippet } from "./snippet";
import { defineSrAvatar, type SrAvatarElement } from "./srAvatar";
import styles from "./EmbedPage.module.css";

const MOODS = Object.keys(EMOTION_TABLE) as Emotion[];
const SLUG = /^[a-z0-9-]+$/;

type Copy = "idle" | "copied" | "failed";

export default function EmbedPage({ plane }: { plane: Plane }): ReactElement {
  const [cast, setCast] = useState<CastEntry[] | undefined>(undefined);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [mood, setMood] = useState<Emotion | undefined>(undefined);
  const [copy, setCopy] = useState<Copy>("idle");
  const host = useRef<HTMLDivElement>(null);
  const avatar = useRef<SrAvatarElement | undefined>(undefined);

  useEffect(() => {
    const abort = new AbortController();
    void loadCastIndex({ signal: abort.signal }).then((entries) => {
      if (abort.signal.aborted) return;
      const usable = entries.filter((entry) => SLUG.test(castSlugOf(entry)));
      setCast(usable);
      setSlug(usable[0] === undefined ? undefined : castSlugOf(usable[0]));
    });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const box = host.current;
    if (box === null) return;
    defineSrAvatar();
    const element = document.createElement("sr-avatar");
    element.className = styles.avatar ?? "";
    box.append(element);
    avatar.current = element;
    return () => {
      element.remove();
      avatar.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (slug !== undefined) avatar.current?.setAttribute("src", packUrlOf(slug));
  }, [slug]);

  useEffect(() => {
    if (mood === undefined) avatar.current?.removeAttribute("mood");
    else avatar.current?.setMood(mood);
  }, [mood]);

  const snippet = slug === undefined ? undefined : embedSnippet(window.location.origin, slug, mood);

  const copySnippet = async (): Promise<void> => {
    if (snippet === undefined) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <section className={styles.page} data-page="embed" data-plane={plane} aria-label="Embed">
      <header className={styles.head}>
        <h2 className={styles.title}>Embed</h2>
        <p className={styles.lead}>A character on any web page: one script, one tag. It breathes, blinks and changes mood; give it audio and it talks.</p>
      </header>

      <div className={styles.body}>
        <div className={styles.stage} ref={host} data-embed-stage="" />

        <div className={styles.controls}>
          <label className={styles.field}>
            <span className={styles.label}>Character</span>
            {cast === undefined ? (
              <span className={styles.note}>Loading the cast...</span>
            ) : cast.length === 0 ? (
              <span className={styles.note}>No cast packs are published here.</span>
            ) : (
              <select
                className={styles.input}
                name="pack"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setCopy("idle");
                }}
              >
                {cast.map((entry) => (
                  <option key={entry.id} value={castSlugOf(entry)}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className={styles.field} role="group" aria-label="Mood">
            <span className={styles.label}>Mood</span>
            <div className={styles.keys}>
              {[undefined, ...MOODS].map((id) => (
                <button
                  key={id ?? "saved"}
                  type="button"
                  className={styles.key}
                  aria-pressed={mood === id}
                  onClick={() => {
                    setMood(id);
                    setCopy("idle");
                  }}
                >
                  {id ?? "as saved"}
                </button>
              ))}
              <button type="button" className={styles.key} onClick={() => avatar.current?.gesture("nod")}>
                nod
              </button>
            </div>
          </div>
        </div>
      </div>

      {snippet !== undefined && (
        <div className={styles.field}>
          <span className={styles.label}>Paste into your page</span>
          <pre className={styles.snippet} data-embed-snippet="">
            <code>{snippet}</code>
          </pre>
          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={() => void copySnippet()}>
              Copy snippet
            </button>
            <span className={styles.note} role="status">
              {copy === "copied" ? "Copied." : copy === "failed" ? "Copy was refused: select the snippet and copy it." : ""}
            </span>
          </div>
        </div>
      )}

      <p className={styles.note}>
        Attributes: <code>src</code> (pack URL), <code>mood</code>, <code>background</code> (a CSS colour, transparent by default) and{" "}
        <code>mic</code> (shows a Click to listen button that lip-syncs it to the microphone). From script: <code>setMood()</code>,{" "}
        <code>gesture()</code>, <code>setLevel()</code>, <code>attachAudio()</code>. Another site loads the script and the pack from
        this deploy, which must allow it (CORS); or host your own copies of <code>sr-avatar.js</code> and the <code>.srpack</code>.
      </p>
    </section>
  );
}
