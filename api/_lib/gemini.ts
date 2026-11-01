// Gemini client for the forge (forge-pipeline design.md, task 6.1): generateImage, editImage and
// generateJson over the REST `generateContent` endpoint. `fetch` is injected, so tests never call
// the network. Every failure is a `GeminiError`: spec code `upstream`, our own message, and a
// `reason` for logs. Upstream bodies are never read on failure and never copied into an error;
// the key travels only in the `x-goog-api-key` header, never in a URL, a message or a log.
import { ApiError } from "./errors.js";
import type { FetchLike } from "./kv.js";
import type { Env } from "./plane.js";

export type { FetchLike } from "./kv.js";

/** Defaults named in .env.example; the env variables override them (tech.md: models are config). */
export const DEFAULT_MODELS: Readonly<GeminiModels> = {
  image: "gemini-3-pro-image",
  imageDraft: "gemini-3.1-flash-image",
  segment: "gemini-3.8-flash",
};

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";

/** One step must fit in a 60 s function invocation (requirement 7.2). */
export const DEFAULT_TIMEOUT_MS = 55_000;

export interface GeminiModels {
  /** Final image model, `SR_IMAGE_MODEL`. */
  image: string;
  /** Draft image model, `SR_IMAGE_DRAFT_MODEL`. */
  imageDraft: string;
  /** Segmentation and classification model (JSON answers), `SR_SEGMENT_MODEL`. */
  segment: string;
}

export function geminiModels(env: Env = process.env): GeminiModels {
  const pick = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  return {
    image: pick(env.SR_IMAGE_MODEL, DEFAULT_MODELS.image),
    imageDraft: pick(env.SR_IMAGE_DRAFT_MODEL, DEFAULT_MODELS.imageDraft),
    segment: pick(env.SR_SEGMENT_MODEL, DEFAULT_MODELS.segment),
  };
}

export interface GeminiImage {
  mimeType: string;
  data: Uint8Array;
}

export type GeminiFailure =
  | "no_key" // GEMINI_API_KEY is not set
  | "timeout" // our timer fired
  | "network" // fetch rejected for another reason
  | "rate_limited" // HTTP 429
  | "http" // any other non-2xx
  | "malformed" // 2xx but not the generateContent shape
  | "blocked" // the model refused (prompt or output safety)
  | "no_image" // answered without an image
  | "no_text"; // answered without text

const MESSAGES: Record<GeminiFailure, string> = {
  no_key: "The forge is not configured.",
  timeout: "The forge took too long to answer.",
  network: "The forge could not be reached.",
  rate_limited: "The forge is busy. Try again in a minute.",
  http: "The forge failed to answer.",
  malformed: "The forge answered with something unreadable.",
  blocked: "The forge refused this request.",
  no_image: "The forge answered without an image.",
  no_text: "The forge answered without a result.",
};

export class GeminiError extends ApiError<"upstream"> {
  readonly reason: GeminiFailure;
  /** The upstream HTTP status, for logs only. */
  readonly httpStatus: number | undefined;

  constructor(reason: GeminiFailure, httpStatus?: number) {
    super("upstream", MESSAGES[reason]);
    this.name = "GeminiError";
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

export interface CallOptions {
  /** Overrides the client's timeout for this call (the fill edit uses 30 s, requirement 5.3). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ImageOptions extends CallOptions {
  /** Use the draft model (`SR_IMAGE_DRAFT_MODEL`) instead of the final one. */
  draft?: boolean;
}

export interface GeminiClient {
  readonly models: GeminiModels;
  /** Text to a 1:1 image. */
  generateImage(prompt: string, options?: ImageOptions): Promise<GeminiImage>;
  /** Image + instruction to a new 1:1 image (restyle, fill). Final model unless `draft`. */
  editImage(image: GeminiImage, prompt: string, options?: ImageOptions): Promise<GeminiImage>;
  /**
   * Prompt (and optional image) to the segmentation model with `responseMimeType:
   * application/json`. Returns the reply text unparsed: the caller hands it to its validator.
   */
  generateJson(prompt: string, image?: GeminiImage, options?: CallOptions): Promise<string>;
}

export interface GeminiConfig {
  apiKey: string | undefined;
  models?: GeminiModels;
  fetch?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
}

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const IMAGE_CONFIG = { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } };
const JSON_CONFIG = { responseMimeType: "application/json" };
const BLOCKING_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_PROHIBITED_CONTENT"]);

function inline(image: GeminiImage): ContentPart {
  return { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64") } };
}

export function createGemini(config: GeminiConfig): GeminiClient {
  const models = config.models ?? DEFAULT_MODELS;
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = config.baseUrl ?? GEMINI_API;
  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(model: string, parts: ContentPart[], generationConfig: object, options: CallOptions): Promise<unknown[]> {
    const key = config.apiKey?.trim();
    if (!key) throw new GeminiError("no_key");
    const timer = AbortSignal.timeout(options.timeoutMs ?? defaultTimeout);
    const signal = options.signal ? AbortSignal.any([timer, options.signal]) : timer;
    let body: unknown;
    try {
      const res = await doFetch(`${baseUrl}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
        signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new GeminiError(res.status === 429 ? "rate_limited" : "http", res.status);
      }
      try {
        body = await res.json();
      } catch {
        throw new GeminiError(timer.aborted ? "timeout" : "malformed", res.status);
      }
    } catch (err) {
      if (err instanceof GeminiError) throw err;
      throw new GeminiError(timer.aborted ? "timeout" : "network");
    }
    return candidateParts(body);
  }

  async function image(model: string, parts: ContentPart[], options: CallOptions): Promise<GeminiImage> {
    const reply = await call(model, parts, IMAGE_CONFIG, options);
    for (const part of reply) {
      const data = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : undefined;
      if (data && typeof data.data === "string" && data.data.length > 0 && typeof data.mimeType === "string") {
        return { mimeType: data.mimeType, data: new Uint8Array(Buffer.from(data.data, "base64")) };
      }
    }
    throw new GeminiError("no_image");
  }

  return {
    models,
    generateImage: (prompt, options = {}) =>
      image(options.draft ? models.imageDraft : models.image, [{ text: prompt }], options),
    editImage: (source, prompt, options = {}) =>
      image(options.draft ? models.imageDraft : models.image, [inline(source), { text: prompt }], options),
    async generateJson(prompt, source, options = {}) {
      const parts: ContentPart[] = source ? [inline(source), { text: prompt }] : [{ text: prompt }];
      const reply = await call(models.segment, parts, JSON_CONFIG, options);
      // Thinking models may add `thought: true` parts; only the answer counts.
      const text = reply
        .filter((p) => isRecord(p) && typeof p.text === "string" && p.thought !== true)
        .map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
        .join("");
      if (text.trim() === "") throw new GeminiError("no_text");
      return text;
    },
  };
}

/** The client the live plane uses: key and model ids from the environment. */
export function geminiFromEnv(env: Env = process.env, fetchImpl?: FetchLike): GeminiClient {
  return createGemini({ apiKey: env.GEMINI_API_KEY, models: geminiModels(env), ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parts of the first candidate; a refusal or an unknown shape is a `GeminiError`. */
function candidateParts(body: unknown): unknown[] {
  if (!isRecord(body)) throw new GeminiError("malformed");
  const feedback = body.promptFeedback;
  if (isRecord(feedback) && typeof feedback.blockReason === "string") throw new GeminiError("blocked");
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) throw new GeminiError("malformed");
  const first: unknown = candidates[0];
  if (!isRecord(first)) throw new GeminiError("malformed");
  const parts = isRecord(first.content) ? first.content.parts : undefined;
  if (Array.isArray(parts) && parts.length > 0) return parts;
  if (typeof first.finishReason === "string" && BLOCKING_FINISH.has(first.finishReason)) throw new GeminiError("blocked");
  throw new GeminiError("malformed");
}
