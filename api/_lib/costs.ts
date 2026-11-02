// Cost estimates per paid call in US dollars, charged against `SR_DAILY_USD_CAP` by quota.ts
// (forge-pipeline design.md "Quota"). Shared with voice-and-air. Illustrative, not billing:
// rounded up from list prices so the cap trips early rather than late.

export const COST_USD = {
  /** One draft portrait (`SR_IMAGE_DRAFT_MODEL`). */
  imageDraft: 0.04,
  /** One final portrait or restyle (`SR_IMAGE_MODEL`). */
  imageFinal: 0.14,
  /** One fill edit with the final image model (requirement 5.2). */
  imageEdit: 0.14,
  /** One parts request to the segmentation model, including a re-ask. */
  segment: 0.01,
  /** One likeness/content classification of an upload. */
  classify: 0.005,
  /** One spoken line (Gemini TTS, at most 300 characters). */
  voiceLine: 0.005,
  /** One character brief (cast-forge 4.1; Anthropic Messages API, up to 3000 tokens), including a re-ask. */
  brief: 0.03,
  /** One chat-engine reply (Anthropic Messages API, max_tokens 300). */
  engineReply: 0.003,
} as const;

export type CostItem = keyof typeof COST_USD;
