// The recorded shows the replay plane serves (voice-and-air requirements 1.2, 2.2, 3.3): Malakor's
// night and one night per other seeded character (`assets/replay/shows/<slug>-night.json`). The
// JSON is imported, so the function bundle carries it and replay needs no file system; each file is
// validated once by `parseShow` from @sr/engine. `recorded.json` lists the WAVs that really exist.
import { parseShow, showOf, type ShowBank, type ShowScript } from "@sr/engine";
import announcer from "../../assets/replay/shows/announcer-of-dead-air-night.json";
import auntieAsp from "../../assets/replay/shows/auntie-asp-night.json";
import lanternWarden from "../../assets/replay/shows/lantern-warden-night.json";
import lotNinety from "../../assets/replay/shows/lot-ninety-night.json";
import malakorJson from "../../assets/replay/shows/malakor-night.json";
import mothWidow from "../../assets/replay/shows/moth-widow-night.json";
import recordedJson from "../../assets/replay/shows/recorded.json";
import reveille from "../../assets/replay/shows/reveille-night.json";
import saintCardia from "../../assets/replay/shows/saint-cardia-night.json";
import sirVacant from "../../assets/replay/shows/sir-vacant-night.json";
import sisterVesper from "../../assets/replay/shows/sister-vesper-night.json";
import theRedactor from "../../assets/replay/shows/the-redactor-night.json";
import theTallyman from "../../assets/replay/shows/the-tallyman-night.json";
import understudy from "../../assets/replay/shows/understudy-night.json";
import vicar from "../../assets/replay/shows/vicar-of-the-lure-night.json";

const SOURCES: readonly (readonly [string, unknown])[] = [
  ["malakor-night", malakorJson],
  ["announcer-of-dead-air-night", announcer],
  ["auntie-asp-night", auntieAsp],
  ["lantern-warden-night", lanternWarden],
  ["lot-ninety-night", lotNinety],
  ["moth-widow-night", mothWidow],
  ["reveille-night", reveille],
  ["saint-cardia-night", saintCardia],
  ["sir-vacant-night", sirVacant],
  ["sister-vesper-night", sisterVesper],
  ["the-redactor-night", theRedactor],
  ["the-tallyman-night", theTallyman],
  ["understudy-night", understudy],
  ["vicar-of-the-lure-night", vicar],
];

let cached: ShowBank | undefined;

/** Every recorded show and the WAV paths that exist. Throws when a committed file does not validate (a build error). */
export function replayBank(): ShowBank {
  if (cached) return cached;
  const shows = SOURCES.map(([name, json]): ShowScript => {
    const show = parseShow(json);
    if (show === undefined) throw new Error(`assets/replay/shows/${name}.json does not validate`);
    return show;
  });
  const recorded = new Set<string>(recordedJson.recorded);
  cached = { shows, recorded };
  return cached;
}

/** The Malakor night show (the house show, and the stand-in for characters without one). */
export function replayShow(): ShowScript {
  const show = replayBank().shows[0];
  if (show === undefined) throw new Error("no replay shows");
  return show;
}

/** The show of `characterId` (library id or slug), else the Malakor night. */
export function replayShowFor(characterId: string): ShowScript {
  return showOf(replayBank().shows, characterId) ?? replayShow();
}
