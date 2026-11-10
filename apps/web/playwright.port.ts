// The Playwright configs' preview port (perfection-pass requirement 14.4): read from an environment
// variable (SR_E2E_PORT for the e2e suite, SR_VISUAL_PORT for the visual guard) so two checkouts
// can run side by side; unset or empty keeps the committed default.

/** The port `env[name]` names (a whole number 1..65535), else `fallback`; junk throws, never falls back. */
export function portFrom(env: Readonly<Record<string, string | undefined>>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}=${raw} is not a port (1..65535).`);
  return port;
}
