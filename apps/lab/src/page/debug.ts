// `?debug=1`: the live event list, newest first, over the stage. Visible live only (the recording
// is the composited canvas), and its arrival fade honours prefers-reduced-motion.
import type { TimelineEvent } from "../contract.js";
import styles from "./stage.module.css";

const KEEP = 40;

function describe(e: TimelineEvent): string {
  switch (e.kind) {
    case "turn":
      return `turn ${e.turn} ${e.chat.user}: ${e.chat.text}`;
    case "say":
      return `say ${e.id}: ${e.text}`;
    case "audio":
      return `audio ${e.id} ${e.durationMs} ms`;
    case "viseme":
      return `viseme ${e.v} ${e.startMs}-${e.endMs}`;
    case "emotion":
      return `emotion ${e.value}`;
    case "gesture":
      return `gesture ${e.value}`;
    case "scene":
      return `scene ${JSON.stringify(e)}`;
    case "mark":
      return `mark ${e.name}`;
  }
}

export interface DebugList {
  add(event: TimelineEvent | string): void;
}

export function createDebugList(stage: HTMLElement): DebugList {
  const list = document.createElement("ol");
  list.className = styles.debug ?? "";
  list.setAttribute("aria-live", "off");
  stage.append(list);
  return {
    add(event) {
      // Visemes arrive by the dozen per line; they would flood the list.
      if (typeof event !== "string" && event.kind === "viseme") return;
      const item = document.createElement("li");
      item.className = styles.debugItem ?? "";
      item.textContent = typeof event === "string" ? event : `${(event.t / 1000).toFixed(1)}s ${describe(event)}`;
      list.prepend(item);
      while (list.children.length > KEEP) list.lastElementChild?.remove();
    },
  };
}
