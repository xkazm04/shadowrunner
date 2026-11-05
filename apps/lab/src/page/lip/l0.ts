// L0, the baseline lip arm: loudness jaw, as the product does today. The stage's audio output node
// is attached to the player (attachAudio), whose RMS tap drives the jaw; visemes are ignored.
import type { LipDriverFactory } from "../types.js";

export const createL0: LipDriverFactory = ({ player, audio }) => {
  player.attachAudio(audio.output);
  return {
    id: "L0",
    onAudio() {},
    onViseme() {},
    frame() {},
    dispose() {
      player.attachAudio(undefined);
    },
  };
};
