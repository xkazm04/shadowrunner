// A small Gemini image-edit client for L2's mouth sets (Node only: the key never reaches a page).
// The request is the forge's (api/_lib/gemini.ts, read for its shape, not imported):
// POST <base>/<model>:generateContent with the key in `x-goog-api-key`, one user turn of
// [inlineData image, text], responseModalities TEXT+IMAGE, a 1:1 1K image. Upstream bodies are never
// copied into an error and the key never into a URL, message or log.

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
/** The forge's final image model (api/_lib/gemini.ts DEFAULT_MODELS.image); SR_IMAGE_MODEL overrides. */
export const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";
/** The forge's draft image model; `--draft` picks it (SR_IMAGE_DRAFT_MODEL overrides). */
export const DEFAULT_DRAFT_MODEL = "gemini-3.1-flash-image";
/** USD per edit, as the forge charges an image edit (api/_lib/costs.ts COST_USD.imageEdit / imageDraft). */
export const USD_PER_EDIT = 0.14;
export const USD_PER_DRAFT_EDIT = 0.04;
export const EDIT_TIMEOUT_MS = 60_000;

export const NO_KEY_SENTENCE =
  "GEMINI_API_KEY is not set, so L2's mouths cannot be generated: the image model (Gemini) is called from Node with that key. Set it, or pass --placeholder for a deterministic stand-in set built from the character's own art (no model call).";

export interface InlineImage {
  mimeType: string;
  data: Uint8Array;
}

export interface ImageEditor {
  readonly model: string;
  readonly usdPerEdit: number;
  edit(image: InlineImage, prompt: string): Promise<InlineImage>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GeminiEditorConfig {
  apiKey: string | undefined;
  draft?: boolean;
  model?: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first inline image of the first candidate, or a sentence saying why there is none. */
export function imageOfReply(body: unknown): InlineImage | string {
  if (!isRecord(body)) return "Gemini answered with something unreadable.";
  if (isRecord(body.promptFeedback) && typeof body.promptFeedback.blockReason === "string") return "Gemini refused this request.";
  const first: unknown = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (!isRecord(first)) return "Gemini answered without a candidate.";
  const parts: unknown = isRecord(first.content) ? first.content.parts : undefined;
  for (const part of Array.isArray(parts) ? parts : []) {
    const data = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : undefined;
    if (data !== undefined && typeof data.data === "string" && data.data.length > 0 && typeof data.mimeType === "string") {
      return { mimeType: data.mimeType, data: new Uint8Array(Buffer.from(data.data, "base64")) };
    }
  }
  return typeof first.finishReason === "string" && first.finishReason !== "STOP" ? `Gemini stopped (${first.finishReason}) without an image.` : "Gemini answered without an image.";
}

/** Throws NO_KEY_SENTENCE without a key, before any request is made. */
export function geminiEditor(config: GeminiEditorConfig): ImageEditor {
  const key = config.apiKey?.trim();
  if (!key) throw new Error(NO_KEY_SENTENCE);
  const model = config.model ?? (config.draft === true ? DEFAULT_DRAFT_MODEL : DEFAULT_IMAGE_MODEL);
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  const base = config.baseUrl ?? GEMINI_API;
  return {
    model,
    usdPerEdit: config.draft === true ? USD_PER_DRAFT_EDIT : USD_PER_EDIT,
    async edit(image, prompt) {
      const body = {
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64") } }, { text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
      };
      let res: Response;
      try {
        res = await doFetch(`${base}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs ?? EDIT_TIMEOUT_MS),
        });
      } catch (error) {
        throw new Error(`Gemini could not be reached (${error instanceof Error ? error.name : "error"}).`, { cause: error });
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(res.status === 429 ? "Gemini is rate limiting (HTTP 429); try again in a minute." : `Gemini answered HTTP ${res.status}.`);
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error("Gemini answered with something unreadable.");
      }
      const out = imageOfReply(json);
      if (typeof out === "string") throw new Error(out);
      return out;
    },
  };
}
