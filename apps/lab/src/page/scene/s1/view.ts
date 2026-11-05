// S1's live half: DOM layers in the stage, updated every frame from the same SceneFrame the
// painters record. The back layer goes under the avatar canvas, the front layer right over it.
import styles from "../s1.module.css";
import type { SceneFrame } from "./model.js";
import { CANDLE_X } from "./paint.js";

export interface S1View {
  update(frame: SceneFrame): void;
  dispose(): void;
}

/** Stage pixels per rem inside the front layer (16 px rem, scaled 2x; see s1.module.css). */
const STAGE_PX_PER_REM = 32;

const cls = (name: string): string => styles[name] ?? "";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, name: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls(name);
  parent?.append(node);
  return node;
}

const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

const show = (node: HTMLElement, alpha: number | undefined): void => {
  node.hidden = alpha === undefined || alpha <= 0;
  if (!node.hidden) node.style.setProperty("--s1-alpha", (alpha ?? 0).toFixed(3));
};

export function createDomView(stage: HTMLElement): S1View {
  const back = el("div", "back");
  const warm = el("div", "warm", back);
  const cold = el("div", "cold", back);
  const front = el("div", "front");
  const dark = el("div", "dark", front);
  const candles = CANDLE_X.map((x, i) => {
    const candle = el("div", "candle", front);
    candle.style.insetInlineStart = `${(x * 100).toFixed(1)}%`;
    const wax = el("div", "wax", candle);
    wax.style.setProperty("--s1-wax", `${(70 + (i % 3) * 18) / STAGE_PX_PER_REM}rem`);
    return { halo: el("div", "halo", wax), flame: el("div", "flame", wax) };
  });
  const card = el("section", "card", front);
  const cardTitle = el("h2", "cardTitle", card);
  const cardBody = el("p", "cardBody", card);
  const poll = el("section", "poll", front);
  const pollQuestion = el("h3", "pollQuestion", poll);
  const pollOptions = el("ol", "pollOptions", poll);
  const pollClosed = el("p", "pollClosed", poll);
  pollClosed.textContent = "Poll closed";
  const caption = el("p", "caption", front);
  let options = "";

  stage.prepend(back);
  const avatar = stage.querySelector("canvas");
  if (avatar !== null) avatar.after(front);
  else stage.append(front);

  return {
    update(f) {
      warm.style.setProperty("--s1-alpha", Math.min(1, f.light.level * f.light.warmth).toFixed(3));
      cold.style.setProperty("--s1-alpha", Math.min(1, f.light.level * (1 - f.light.warmth)).toFixed(3));
      dark.style.setProperty("--s1-alpha", f.light.dark.toFixed(3));
      candles.forEach((c, i) => {
        const size = f.candles.flames[i] ?? 0;
        c.flame.style.setProperty("--s1-flame", size.toFixed(3));
        c.flame.style.setProperty("--s1-flame-w", size <= 0.01 ? "0" : Math.min(1.6, 0.6 + size * 0.5).toFixed(3));
        show(c.halo, size <= 0.01 ? undefined : Math.min(0.55, 0.3 * f.candles.glow + 0.1));
        c.halo.style.setProperty("--s1-halo", Math.max(f.candles.glow, size).toFixed(3));
      });
      show(card, f.card?.alpha);
      if (f.card !== undefined) {
        setText(cardTitle, f.card.title);
        setText(cardBody, f.card.body ?? "");
        cardBody.hidden = f.card.body === undefined;
        card.style.setProperty("--s1-rise", `${(f.card.rise / STAGE_PX_PER_REM).toFixed(3)}rem`);
      }
      show(poll, f.poll?.alpha);
      if (f.poll !== undefined) {
        setText(pollQuestion, f.poll.question);
        const joined = f.poll.options.join("\n");
        if (joined !== options) {
          options = joined;
          pollOptions.replaceChildren(...f.poll.options.map((o) => Object.assign(document.createElement("li"), { textContent: o })));
        }
        pollClosed.hidden = !f.poll.closed;
      }
      show(caption, f.caption?.alpha);
      if (f.caption !== undefined) {
        setText(caption, f.caption.text);
        caption.className = `${cls("caption")} ${cls(f.caption.style)}`;
        caption.style.setProperty("--s1-shake", `${(f.caption.shake / STAGE_PX_PER_REM).toFixed(3)}rem`);
      }
    },
    dispose() {
      back.remove();
      front.remove();
    },
  };
}
