// The brief client (cast-forge requirement 4.3): the creator's door to POST /api/forge/brief.
// Wire types come from `@sr/forge/wire`; the brief is checked with `parseBrief` from the pure,
// browser-safe `@sr/forge/brief` before the card shows it. On the replay plane the brief is read in
// the browser from the committed cast briefs (assets/characters/cast/<slug>/brief.json: the eight
// recorded contest briefs and, perfection-pass task 13, five written after the recording),
// like the replay forge, with no request to /api: the exact one_line_request, else the nearest by
// `recordedBriefMatch` (perfection-pass task 8, the same matcher the API's replay uses), with the
// note the card shows ("Recorded: <name>, chosen for ..."). The forge then walks the job recorded
// from that brief's one_line_request, so the brief shown and the character forged agree.
import { briefFromRecorded, parseBrief, readCastMatchNote, recordedBriefMatch, type CastMatchNote } from "@sr/forge/brief";
import type { BriefResponse, CharacterBrief } from "@sr/forge/wire";
import { apiFetch, type Fetcher, type Plane } from "../app/plane";
import { errorFromBody, ForgeError } from "./forgeClient";

/** A brief answer; a replay answer carries why that recording was chosen (`match`). */
export type BriefAnswer = BriefResponse & { match?: CastMatchNote };

export interface BriefClient {
  /** POST /api/forge/brief */
  brief(request: string): Promise<BriefAnswer>;
}

export const BRIEF_URL = "/api/forge/brief";

/** A checked BriefAnswer, or undefined when the value is not one (a malformed `match` is dropped). */
export function readBriefResponse(value: unknown): BriefAnswer | undefined {
  if (typeof value !== "object" || value === null || !("brief" in value) || !("plane" in value)) return undefined;
  const plane = value.plane;
  if (plane !== "replay" && plane !== "live") return undefined;
  const brief = parseBrief(value.brief);
  if (!brief.ok) return undefined;
  const match = plane === "replay" && "match" in value ? readCastMatchNote(value.match) : undefined;
  return match === undefined ? { brief: brief.value, plane } : { brief: brief.value, plane, match };
}

/** The live client, through `apiFetch` (so `?plane=replay` adds `x-sr-plane: replay`). */
export function createHttpBriefClient(fetcher: Fetcher = apiFetch): BriefClient {
  return {
    async brief(request) {
      let res: Response;
      try {
        res = await fetcher(BRIEF_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ request }),
        });
      } catch {
        throw new ForgeError("upstream", "The brief writer could not be reached.");
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) throw errorFromBody(body, res.status);
      const answer = readBriefResponse(body);
      if (answer === undefined) throw new ForgeError("upstream", "The brief writer sent something the creator cannot read.");
      return answer;
    },
  };
}

const RECORDED = import.meta.glob<unknown>("../../../../assets/characters/cast/*/brief.json", { import: "default" });

let loaded: Promise<CharacterBrief[]> | undefined;

/** The recorded briefs, adapted and checked, in slug order. Loaded once per page. */
export function loadRecordedBriefs(): Promise<CharacterBrief[]> {
  loaded ??= (async () => {
    const paths = Object.keys(RECORDED).sort();
    const briefs = await Promise.all(paths.map(async (path) => briefFromRecorded(await RECORDED[path]?.())));
    return briefs.flatMap((b) => (b.ok ? [b.value] : []));
  })();
  return loaded;
}

/** The in-browser replay twin: zero requests, the recorded brief nearest the request and why. */
export function createReplayBriefClient(briefs: () => Promise<readonly CharacterBrief[]> = loadRecordedBriefs): BriefClient {
  return {
    async brief(request) {
      if (request.trim() === "") throw new ForgeError("bad_input", "Describe the character.");
      const answer = recordedBriefMatch(request, await briefs());
      if (answer === undefined) throw new ForgeError("upstream", "No recorded briefs are available.");
      return { brief: answer.brief, plane: "replay", match: answer.match };
    },
  };
}

/** The brief client for this plane. */
export function briefClientFor(plane: Plane): BriefClient {
  return plane === "replay" ? createReplayBriefClient() : createHttpBriefClient();
}
