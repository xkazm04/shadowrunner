// Test-only helpers for the DOM tests of apps/web (files that opt in with
// `// @vitest-environment happy-dom`). Never imported by app code, so never bundled.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import type { Motion } from "./theme";

// React's act() checks this flag on the global object.
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const REDUCE = "(prefers-reduced-motion: reduce)";
const realMatchMedia = window.matchMedia.bind(window);

/** What `prefers-reduced-motion` answers from now on (happy-dom evaluates the rest). */
export function setMotion(motion: Motion): void {
  window.matchMedia = (query: string) =>
    realMatchMedia(query.replace(REDUCE, motion === "reduced" ? "(min-width: 0px)" : "(max-width: 0px)"));
}

export function restoreMotion(): void {
  window.matchMedia = realMatchMedia;
}

export interface Mounted {
  container: HTMLElement;
  rerender(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** A keydown on window, as the shell's keymap hears it. Returns whether it was prevented. */
export async function press(key: string): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Advance fake timers inside act(), so React flushes what they set. */
export async function elapse(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Let pending dynamic imports (the fx chunk) resolve, inside act(). */
export async function settleImports(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
