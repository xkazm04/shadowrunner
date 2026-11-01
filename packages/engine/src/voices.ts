// The fixed voice list (voice-and-air design.md, "Contracts"). The creator offers these ids,
// Persona carries one, and /api/voice accepts nothing else (requirement 3.1).

/** Our voice ids, in the order the creator lists them. */
export const VOICE_IDS = ["crypt", "velvet", "rasp", "choir", "clerk"] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export interface Voice {
  /** Gemini TTS prebuilt voice name sent upstream. */
  gemini: string;
  /** Our label, shown in the creator. */
  label: string;
}

/**
 * Voice id -> Gemini prebuilt voice. The Gemini names are provisional until task 4 picks them by
 * listening; the ids and labels are the contract. Malakor uses `clerk`.
 */
export const VOICES: Readonly<Record<VoiceId, Voice>> = {
  crypt: { gemini: "Charon", label: "Crypt: low and slow" },
  velvet: { gemini: "Sulafat", label: "Velvet: warm and close" },
  rasp: { gemini: "Algenib", label: "Rasp: gravel and smoke" },
  choir: { gemini: "Aoede", label: "Choir: airy and distant" },
  clerk: { gemini: "Iapetus", label: "Clerk: dry and precise" },
};
