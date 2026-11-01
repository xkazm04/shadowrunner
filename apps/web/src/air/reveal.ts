// Word-by-word captions (costume requirement 8.1, design.md "Air"): the line is laid out whole
// from the start, every word in its final place, and the words light up in order as the line
// plays. Nothing reflows, so no word ever jumps from one line to the next mid-sentence. Pure:
// which words are lit for a playback progress in [0, 1]. Longer words and the pause after a
// stop take longer, the way the voice reads them.

/** A caption line's words, split on whitespace. */
export function captionWords(line: string): string[] {
  return line.split(/\s+/).filter((w) => w !== "");
}

/** How long a caption-only line takes to reveal: a reading pace, held inside a beat. */
export function readMs(words: number, beatMs: number): number {
  return Math.min(beatMs * 0.8, Math.max(1_500, words * 330));
}

function weight(word: string): number {
  const pause = /[.?!]$/.test(word) ? 6 : /[,;:]$/.test(word) ? 3 : 1;
  return 2 + word.length + pause;
}

/**
 * How many leading words are lit at `progress` (0: none, 1: all). Non-decreasing in progress;
 * non-finite progress lights nothing. A word lights when playback reaches its start.
 */
export function revealedCount(words: readonly string[], progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return words.length;
  const total = words.reduce((sum, w) => sum + weight(w), 0);
  if (total === 0) return words.length;
  const at = progress * total;
  let start = 0;
  let count = 0;
  for (const w of words) {
    if (start > at) break;
    count += 1;
    start += weight(w);
  }
  return count;
}
