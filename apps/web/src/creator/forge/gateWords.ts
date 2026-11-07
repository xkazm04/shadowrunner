// forge-creator S1, say why a face was refused: a family's gate reading (faceGate.ts) in plain
// words, with its number where it has one: "the eyes moved 7.2 px (limit 4)". Used by the Face
// tab's FACES card and the rite's Wake mark. Pure.
import type { FaceGateReading } from "@sr/forge/faceGate";

/** A reading's number as written: one decimal at most ("7.2", "4"). */
export const num = (n: number): string => String(Math.round(n * 10) / 10 + 0);

const limitText = (limit: number | undefined): string => (limit === undefined ? "" : ` (limit ${num(limit)})`);

/** The reason alone, lower case, no full stop. */
export function gateWords(reading: FaceGateReading): string {
  switch (reading.reason) {
    case "iris":
      return reading.irisDriftPx === undefined ? "the eyes moved" : `the eyes moved ${num(reading.irisDriftPx)} px${limitText(reading.limit)}`;
    case "band":
      return reading.outsideBandMean === undefined ? "it repainted outside the brows" : `it repainted outside the brows (change ${num(reading.outsideBandMean)}${reading.limit === undefined ? "" : `, limit ${num(reading.limit)}`})`;
    case "drift":
      return reading.drift === undefined ? "the edit drifted" : `the edit drifted (${num(reading.drift)}${reading.limit === undefined ? "" : `, limit ${num(reading.limit)}`})`;
    case "no_change":
      return "the edit changed nothing";
    case "budget":
      return "the daily budget ran out";
    case "failed":
      return "the edit failed";
  }
}

/** The reason with the tries it took when there was more than one: "the eyes moved 7.2 px (limit 4), 3 tries". */
export function gateLine(reading: FaceGateReading): string {
  const words = gateWords(reading);
  return reading.attempts !== undefined && reading.attempts > 1 ? `${words}, ${reading.attempts} tries` : words;
}
