// Transport choice: `--llm api|cli`; default `api` when ANTHROPIC_API_KEY is set, else `cli`.
import { createApiTransport } from "./apiTransport.js";
import { createCliTransport } from "./cliTransport.js";
import type { LlmKind, LlmTransport } from "./types.js";

export * from "./types.js";
export { createMessagesFetch } from "./messagesFetch.js";

export function defaultLlmKind(env: Readonly<Record<string, string | undefined>>): LlmKind {
  return env.ANTHROPIC_API_KEY?.trim() ? "api" : "cli";
}

export function createTransport(kind: LlmKind, env: Readonly<Record<string, string | undefined>>, model?: string): LlmTransport {
  if (kind === "api") {
    const apiKey = env.ANTHROPIC_API_KEY ?? "";
    return createApiTransport({ apiKey, ...(model === undefined ? {} : { model }) });
  }
  return createCliTransport(model === undefined ? {} : { model });
}
