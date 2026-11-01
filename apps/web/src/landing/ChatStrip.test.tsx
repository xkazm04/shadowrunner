import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatStrip, type ChatStripProps } from "./ChatStrip";
import { HISTORY, HOST_TAG, SCRIPT } from "./chatScript";

// The stylesheet's source text. Vitest does not process CSS here (a `?raw` import of it is empty),
// and the app's types have no Node, so node:fs is loaded by a computed specifier and typed locally.
interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
const NODE_FS = ["node", "fs"].join(":");
const fs: Fs = await import(/* @vite-ignore */ NODE_FS);
const source = fs.readFileSync(new URL("./ChatStrip.module.css", import.meta.url), "utf8");
/** The stylesheet without its comments (which name the reference's rules). */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

function strip(over: Partial<ChatStripProps> = {}): string {
  return renderToString(<ChatStrip plane="replay" motion="reduced" {...over} />);
}

/** The declarations of `selector`'s own rule (exact selector, comments stripped). */
function rule(selector: string): string | undefined {
  const at = css.split("}").find((block) => block.split("{")[0]?.trim() === selector);
  return at?.split("{")[1];
}

/** The class name CSS Modules gave `local` in the rendered html. */
function classOf(html: string, local: string): string {
  const name = html.match(new RegExp(`class="([^"]*_${local}_[^" ]*)`))?.[1];
  expect(name, local).toBeDefined();
  return name ?? "";
}

describe("ChatStrip on replay, reduced motion (the static twin)", () => {
  it("is a named section with the board and the host's tag", () => {
    const html = strip();
    expect(html).toMatch(/<section[^>]*aria-label="Live chat \(simulated\)"/);
    expect(html).toContain("LIVE CHAT");
    expect(html).toContain(`<span>${HOST_TAG}</span>`);
  });

  it("shows the history and the first exchange, complete, with no caret and no timer state", () => {
    const html = strip();
    for (const line of [...HISTORY, ...SCRIPT.slice(0, 2)]) expect(html).toContain(line.text);
    expect(html).not.toContain(SCRIPT[2]?.text ?? "-");
    expect(html).not.toContain("data-typing");
    expect(html).not.toMatch(/_caret_/);
    expect(html.match(/data-chat-line="host"/g)).toHaveLength(3);
    expect(html.match(/data-chat-line="viewer"/g)).toHaveLength(3);
  });

  it("writes viewer lines as name · rank then text, and host lines under the host's tag in signal ink", () => {
    const html = strip();
    expect(html).toMatch(/<b>moth_in_a_jar<\/b> <span class="_rank_[^"]*">· Thrall<\/span><br\/>first time here/);
    expect(html).toMatch(new RegExp(`<p class="_line_[^"]* _host_[^"]*" data-chat-line="host"><b>${HOST_TAG}</b><br/>It does\\.`));
  });

  it("puts every line inside the clipped text box, inside the paper", () => {
    const html = strip();
    const paper = html.indexOf("data-chat-paper");
    const box = html.indexOf("data-chat-lines");
    expect(paper).toBeGreaterThan(-1);
    expect(box).toBeGreaterThan(paper);
    expect(html.indexOf("data-chat-line=")).toBeGreaterThan(box);
    // The paper wraps the text box directly.
    expect(html).toMatch(/<div class="_paper_[^"]*" data-chat-paper="true"><div class="_lines_[^"]*" data-chat-lines="true"/);
  });
});

describe("ChatStrip on live", () => {
  it("plays no script: the engine's lines, or an empty paper waiting for them", () => {
    const html = strip({ plane: "live" });
    expect(html).toMatch(/aria-label="Live chat"/);
    expect(html).not.toContain("simulated");
    for (const line of [...HISTORY, ...SCRIPT]) expect(html).not.toContain(line.text);
    expect(html).toContain("Waiting for the first message.");

    const fed = strip({ plane: "live", motion: "full", feed: [{ kind: "host", text: "The ledger is open." }] });
    expect(fed).toContain("The ledger is open.");
    expect(fed).not.toContain("data-typing");
  });
});

describe("ChatStrip styles (contrast and clip, landing task 7)", () => {
  it("backs the text box with the opaque paper role: no opacity, mask, filter or image on the paper", () => {
    const html = strip();
    expect(classOf(html, "paper")).toMatch(/^_paper_/);
    const paper = rule(".paper") ?? "";
    expect(paper).toMatch(/background-color:\s*var\(--sr-paper\);/);
    expect(paper).not.toMatch(/opacity|mask|filter|background-image|mix-blend/);
    // The reference's darkening ::after gradient is not ported.
    expect(css).not.toMatch(/\.paper::after/);
  });

  it("keeps the paper texture at 0.24 opacity or less, lighten-only, under the text box", () => {
    const texture = rule(".paper::before") ?? "";
    expect(texture).toContain("paper.webp");
    // screen and lighten can never take a pixel below `paper`, so the inks keep token contrast.
    expect(texture).toMatch(/mix-blend-mode:\s*(screen|lighten);/);
    const opacity = Number(texture.match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.24);
    expect(texture).not.toMatch(/z-index/);
    expect(rule(".lines") ?? "").toMatch(/z-index:\s*1/);
  });

  it("clips the lines to their own box with a top fade, and sets them in the paper inks at 16 px", () => {
    const box = rule(".lines") ?? "";
    expect(box).toMatch(/overflow:\s*hidden/);
    expect(box).toMatch(/justify-content:\s*flex-end/);
    expect(box).toMatch(/mask-image:\s*linear-gradient\(transparent,/);
    expect(box).toMatch(/color:\s*var\(--sr-paper-ink\)/);
    expect(box).toMatch(/font-size:\s*var\(--sr-size-text\)/);
    expect(box).not.toMatch(/background/);
    expect(rule(".host") ?? "").toMatch(/color:\s*var\(--sr-paper-ink-signal\)/);
  });

  it("stops the caret with reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.caret \{\s*animation: none;/);
    expect(css).toMatch(/:global\(\[data-motion="reduced"\]\) \.caret \{\s*animation: none;/);
  });
});
