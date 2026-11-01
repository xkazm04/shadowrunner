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
/** The stylesheet without its comments. */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

function chat(over: Partial<ChatStripProps> = {}): string {
  return renderToString(<ChatStrip plane="replay" motion="reduced" {...over} />);
}

/** The declarations of `selector`'s own rule (exact selector, comments stripped). */
function rule(selector: string): string | undefined {
  const at = css.split("}").find((block) => block.split("{")[0]?.trim() === selector);
  return at?.split("{")[1];
}

describe("ChatStrip on replay, reduced motion (the static twin)", () => {
  it("is a named section of chalk lines", () => {
    expect(chat()).toMatch(/<section[^>]*aria-label="Live chat \(simulated\)"[^>]*data-chat/);
  });

  it("shows the history and the first exchange, complete, with no caret and no timer state", () => {
    const html = chat();
    for (const line of [...HISTORY, ...SCRIPT.slice(0, 2)]) expect(html).toContain(line.text);
    expect(html).not.toContain(SCRIPT[2]?.text ?? "-");
    expect(html).not.toContain("data-typing");
    expect(html).not.toMatch(/_caret_/);
    expect(html.match(/data-chat-line="host"/g)).toHaveLength(3);
    expect(html.match(/data-chat-line="viewer"/g)).toHaveLength(3);
  });

  it("writes viewer lines as name · rank then text, and host lines under the host's tag in ember", () => {
    const html = chat();
    expect(html).toMatch(/<span class="_user_[^"]*">moth_in_a_jar · Thrall<\/span>first time here/);
    expect(html).toMatch(new RegExp(`<p class="_line_[^"]* _host_[^"]*" data-chat-line="host"><span class="_user_[^"]*">${HOST_TAG}</span>It does[.]`));
    expect(rule(".host") ?? "").toMatch(/color:\s*var\(--sr-ember\)/);
  });

  it("writes PAUSED · NO CARRIER under the lines only while the daemon is lost", () => {
    expect(chat()).not.toContain("NO CARRIER");
    const paused = chat({ paused: true });
    expect(paused).toContain("data-paused");
    expect(paused.indexOf("PAUSED · NO CARRIER")).toBeGreaterThan(paused.indexOf("data-chat-lines"));
  });
});

describe("ChatStrip on live", () => {
  it("plays no script: the engine's lines, or an empty wall waiting for them", () => {
    const html = chat({ plane: "live" });
    expect(html).toMatch(/aria-label="Live chat"/);
    expect(html).not.toContain("simulated");
    for (const line of [...HISTORY, ...SCRIPT]) expect(html).not.toContain(line.text);
    expect(html).toContain("Waiting for the first message.");

    const fed = chat({ plane: "live", motion: "full", feed: [{ kind: "host", text: "The ledger is open." }] });
    expect(fed).toContain("The ledger is open.");
    expect(fed).not.toContain("data-typing");
  });
});

describe("ChatStrip styles", () => {
  it("clips the lines to their own box with a top fade, bottom-anchored", () => {
    const box = rule(".lines") ?? "";
    expect(box).toMatch(/overflow:\s*hidden/);
    expect(box).toMatch(/justify-content:\s*flex-end/);
    expect(box).toMatch(/mask-image:\s*linear-gradient\(transparent,/);
  });

  it("sets the chalk in the hand face at 24 world px (20 on the phone) and the names at 16, never below", () => {
    expect(rule(".line") ?? "").toMatch(/font-family:\s*var\(--sr-font-hand\)/);
    expect(rule(".line") ?? "").toMatch(/font-size:\s*var\(--sr-slide-chalk\)/);
    expect(rule(".user") ?? "").toMatch(/font-size:\s*var\(--sr-size-text\)/);
    expect(css).not.toMatch(/size-text-sm/);
  });

  it("greys the chalk by colour, never by opacity, while paused", () => {
    expect(css).not.toMatch(/opacity:\s*0?\.\d/);
    expect(css).toMatch(/\.chat\[data-paused\] \.line,\s*\.chat\[data-paused\] \.user \{\s*color: var\(--sr-text-muted\);/);
  });

  it("stops the caret with reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.caret \{\s*animation: none;/);
    expect(css).toMatch(/:global\(\[data-motion="reduced"\]\) \.caret \{\s*animation: none;/);
  });
});
