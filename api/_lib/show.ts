// The recorded show the replay plane serves (voice-and-air requirements 1.2, 2.2, 3.3). The JSON is
// imported, so the function bundle carries it and replay needs no file system; it is validated
// once by `parseShow` from @sr/engine.
import { parseShow, type ShowScript } from "@sr/engine";
import showJson from "../../assets/replay/shows/malakor-night.json";

let cached: ShowScript | undefined;

/** The Malakor night show. Throws when the committed file does not validate (a build error). */
export function replayShow(): ShowScript {
  if (cached) return cached;
  const show = parseShow(showJson);
  if (show === undefined) throw new Error("assets/replay/shows/malakor-night.json does not validate");
  cached = show;
  return show;
}
