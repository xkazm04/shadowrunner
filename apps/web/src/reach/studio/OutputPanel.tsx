// What the video looks like (spec avatar-reach "Studio"; perfection-pass task 6, requirements
// 6.3-6.4): the background under the character and the video's size.
//
// Decisions:
// - "Transparent" is offered because the e2e studio test records a take with it and reads the
//   decoded file's pixels over a known colour: the backdrop shows through, the face does not
//   (Chromium's MediaRecorder writes VP8/VP9 alpha). Where it plays see-through is stated beside
//   it: a file that some players show opaque must not surprise anyone.
// - The colour input shows the last colour while Transparent is picked (it cannot show "none").
import type { ReactElement } from "react";
import { ASPECTS, aspectOf, type AspectId } from "./aspect";
import type { Swatch } from "./background";
import { TRANSPARENT } from "./recorder";
import styles from "./Studio.module.css";

export interface OutputPanelProps {
  swatches: readonly Swatch[];
  background: string;
  onBackground(background: string): void;
  /** The last colour picked (the colour input's value). */
  colour: string;
  aspect: AspectId;
  onAspect(aspect: AspectId): void;
  busy: boolean;
}

export const ALPHA_NOTE =
  "Transparent records a WebM with an alpha channel (VP8/VP9). Chrome, Edge, Firefox and OBS media sources show it see-through; Safari and many video editors ignore the alpha and show black.";

export function OutputPanel({ swatches, background, onBackground, colour, aspect, onAspect, busy }: OutputPanelProps): ReactElement {
  const size = aspectOf(aspect).size;
  return (
    <>
      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>Background</legend>
        <div className={styles.swatches}>
          {swatches.map((swatch) => (
            <button
              key={swatch.role}
              type="button"
              className={styles.swatch}
              style={{ background: swatch.hex }}
              aria-label={swatch.label}
              aria-pressed={background === swatch.hex}
              onClick={() => onBackground(swatch.hex)}
            />
          ))}
          <button
            type="button"
            className={`${styles.swatch} ${styles.checker}`}
            aria-label="Transparent"
            aria-pressed={background === TRANSPARENT}
            onClick={() => onBackground(TRANSPARENT)}
            data-studio="transparent"
          />
          <label className={styles.colour}>
            <span>Any colour</span>
            <input type="color" value={colour} onChange={(e) => onBackground(e.target.value)} />
          </label>
        </div>
        {background === TRANSPARENT ? (
          <p className={styles.hint} data-studio="alpha-note">
            {ALPHA_NOTE}
          </p>
        ) : null}
      </fieldset>
      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>Video size</legend>
        <div className={styles.aspects}>
          {ASPECTS.map((a) => (
            <label key={a.id} className={styles.line}>
              <input type="radio" name="studio-aspect" value={a.id} checked={a.id === aspect} onChange={() => onAspect(a.id)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          {size === undefined
            ? "As shown records the stage at its size on this screen."
            : `Recorded at ${size.width} × ${size.height} whatever the screen; the whole character fits, standing on the bottom edge.`}
        </p>
      </fieldset>
    </>
  );
}
