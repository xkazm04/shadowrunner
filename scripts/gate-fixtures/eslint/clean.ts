// Control: must lint clean, proving the fixture failures come from the seeded lines.
export function parseCount(input: unknown): number {
  return typeof input === "number" ? input : 0;
}
