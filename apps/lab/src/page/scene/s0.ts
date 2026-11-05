// S0, the baseline scene arm: ignores scene events. The stage still gets a state-reactive backdrop
// (a light that follows the speech level) so S1 has something to beat. Live it is CSS
// (s0.module.css); for the recording the same light is painted into the composite.
import type { SceneDriverFactory } from "../types.js";
import styles from "./s0.module.css";

/** Level the light holds when reduced motion is on (and motion is not forced). */
export const STEADY_LEVEL = 0.35;
const ATTACK = 0.5;
const RELEASE = 0.08;

/** A theme role's resolved colour (e.g. "ember" -> the halloween theme's --sr-ember). */
function role(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(`--sr-${name}`).trim();
}

export const createS0: SceneDriverFactory = ({ stage, audio, reducedMotion, onFrame, addPainter }) => {
  const backdrop = document.createElement("div");
  backdrop.className = styles.backdrop ?? "";
  const light = document.createElement("div");
  light.className = styles.light ?? "";
  stage.prepend(backdrop, light);
  let level = reducedMotion ? STEADY_LEVEL : 0;
  onFrame(() => {
    if (reducedMotion) return;
    const target = audio.level();
    level += (target - level) * (target > level ? ATTACK : RELEASE);
    light.style.setProperty("--lab-level", level.toFixed(3));
  });
  light.style.setProperty("--lab-level", level.toFixed(3));
  const surface = role(stage, "surface-0");
  const ember = role(stage, "ember");
  addPainter("back", (g) => {
    const { width, height } = g.canvas;
    g.fillStyle = surface;
    g.fillRect(0, 0, width, height);
    const gradient = g.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, height * 0.6);
    gradient.addColorStop(0, ember);
    gradient.addColorStop(1, "transparent");
    g.globalAlpha = 0.15 + 0.6 * level;
    g.fillStyle = gradient;
    g.fillRect(0, 0, width, height);
    g.globalAlpha = 1;
  });
  return {
    id: "S0",
    apply() {},
    dispose() {
      backdrop.remove();
      light.remove();
    },
  };
};
