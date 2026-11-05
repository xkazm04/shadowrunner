// The theme roles S1 paints with, resolved once from the stage's computed style (@sr/theme custom
// properties). Canvas painting cannot read var(); this is the only place colours enter the painter.
export interface Palette {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  ember: string;
  cold: string;
  flame: string;
  paper: string;
  paperInk: string;
  inkSignal: string;
  text: string;
  textStrong: string;
  textMuted: string;
  line: string;
  accent: string;
  onair: string;
  fontDisplay: string;
  fontBody: string;
}

/** Palette key -> theme role (`--sr-<role>`). */
export const ROLES: Readonly<Record<keyof Palette, string>> = {
  surface0: "surface-0",
  surface1: "surface-1",
  surface2: "surface-2",
  surface3: "surface-3",
  ember: "ember",
  cold: "phosphor-2",
  flame: "catacomb-flame",
  paper: "paper",
  paperInk: "paper-ink",
  inkSignal: "paper-ink-signal",
  text: "text",
  textStrong: "text-strong",
  textMuted: "text-muted",
  line: "line",
  accent: "accent",
  onair: "signal-onair",
  fontDisplay: "font-display",
  fontBody: "font-body",
};

export function readPalette(read: (role: string) => string): Palette {
  const out = {} as Record<keyof Palette, string>;
  for (const [key, role] of Object.entries(ROLES) as [keyof Palette, string][]) out[key] = read(role).trim();
  return out;
}
