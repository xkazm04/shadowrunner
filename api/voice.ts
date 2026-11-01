// POST /api/voice { text, voice } -> audio/wav (voice-and-air requirement 3). Vercel Node function.
// - replay plane (default, or `x-sr-plane: replay`): a 303 redirect to the static recording of the
//   show line with that text, or of the recorded fallback phrase, under /replay/shows/ (the deploy
//   copies assets/replay/** to static /replay/**); no file read, no network call, no quota;
// - live plane: `checkAndCharge(ip, "voice", usd)` first, then one Gemini TTS call.
// `voice` must be one of VOICES and `text` at most 300 characters, else `bad_input`.
import { decodeJson, parseVoiceRequest, type ShowScript } from "@sr/engine";
import { COST_USD } from "./_lib/costs.js";
import { ApiError, errorResponse } from "./_lib/errors.js";
import type { FetchLike } from "./_lib/kv.js";
import { planeFromRequest, type Env } from "./_lib/plane.js";
import { checkAndCharge, clientIp, type Quota } from "./_lib/quota.js";
import { replayShow } from "./_lib/show.js";
import { synthesize, ttsModel } from "./_lib/tts.js";

export interface VoiceDeps {
  env: Env;
  fetch: FetchLike;
  quota: Pick<Quota, "checkAndCharge">;
}

const MAX_BODY_BYTES = 8 * 1024;

/** Where the deploy serves assets/replay/shows/** as static files (not through this function). */
export const REPLAY_SHOWS_URL = "/replay/shows/";

/**
 * The static URL of a recording named relative to `assets/replay/shows/`. Throws on an absolute
 * path, an empty segment or `..`, so a show file can never point the redirect elsewhere.
 */
export function recordingUrl(wav: string): string {
  const parts = wav.split(/[/\\]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error("bad recording path");
  return `${REPLAY_SHOWS_URL}${parts.map(encodeURIComponent).join("/")}`;
}

/**
 * The WAV for `text` on replay: the beat whose line is exactly the text, else the recorded
 * fallback phrase (the show's last generic line, which answers anything).
 */
export function recordedWav(show: ShowScript, text: string): { wav: string; fallback: boolean } {
  const hit = show.beats.find((b) => b.reply.line === text.trim());
  if (hit) return { wav: hit.wav, fallback: false };
  const generic = show.beats.filter((b) => b.replyTo === undefined);
  const last = generic.at(-1) ?? show.beats.at(-1);
  if (last === undefined) throw new ApiError("upstream", "No recording is available.");
  return { wav: last.wav, fallback: true };
}

function defaultDeps(): VoiceDeps {
  return { env: process.env, fetch: (url, init) => fetch(url, init), quota: { checkAndCharge } };
}

function wavResponse(bytes: Uint8Array, extra: Record<string, string> = {}): Response {
  return new Response(new Blob([bytes], { type: "audio/wav" }), {
    headers: { "content-type": "audio/wav", "cache-control": "no-store", ...extra },
  });
}

export async function handleVoice(request: Request, deps: VoiceDeps): Promise<Response> {
  try {
    if (request.method !== "POST") throw new ApiError("bad_input", "Use POST.", 405);
    const raw = await request.text().catch(() => "");
    const body = raw.length > MAX_BODY_BYTES ? undefined : parseVoiceRequest(decodeJson(raw));
    if (body === undefined) throw new ApiError("bad_input", "Send { text, voice } with a known voice and at most 300 characters.");

    if (planeFromRequest(request, deps.env) === "replay") {
      // 303: the client's fetch follows with a GET and receives the static WAV itself.
      const { wav, fallback } = recordedWav(replayShow(), body.text);
      return new Response(null, {
        status: 303,
        headers: { location: recordingUrl(wav), "cache-control": "no-store", "x-sr-recorded": fallback ? "fallback" : "line" },
      });
    }

    const apiKey = deps.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new ApiError("upstream", "The voice is not configured.");
    const charged = await deps.quota.checkAndCharge(clientIp(request), "voice", COST_USD.voiceLine);
    if (!charged.ok) throw new ApiError("quota", "The voice has spoken enough for today. Captions only.");
    const wav = await synthesize(body.text, body.voice, { apiKey, model: ttsModel(deps.env), fetch: deps.fetch });
    return wavResponse(wav);
  } catch (err) {
    return errorResponse(err);
  }
}

export function POST(request: Request): Promise<Response> {
  return handleVoice(request, defaultDeps());
}
