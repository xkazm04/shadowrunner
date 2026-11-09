// The load-diet helpers of vite.config.ts (perfection-pass requirement 10.5). The build itself is
// measured by hand (var/perfection/10); these pin the rules it depends on.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { emittedName, inlineRule, isFontsourceCss, LCP_IMAGE, lcpPreloadScript, woff2Only } from "./vite.config";

const require = createRequire(import.meta.url);

describe("woff2Only", () => {
  it("drops every woff fallback of a real @fontsource stylesheet and keeps every woff2", () => {
    const css = readFileSync(require.resolve("@fontsource/inter/400.css"), "utf8");
    const out = woff2Only(css);
    const woff2 = (text: string) => text.match(/\.woff2\)/g)?.length ?? 0;
    expect(woff2(css)).toBeGreaterThan(0);
    expect(woff2(out)).toBe(woff2(css));
    expect(out).not.toMatch(/\.woff\)/);
    expect(out).toMatch(/src: url\(\.\/files\/inter-latin-400-normal\.woff2\) format\('woff2'\);/);
  });

  it("leaves a stylesheet without woff fallbacks as it is", () => {
    const css = `@font-face { src: url(a.woff2) format("woff2"); }`;
    expect(woff2Only(css)).toBe(css);
    expect(woff2Only(`src: url(a.woff2) format("woff2"), url(a.woff) format("woff");`)).toBe(`src: url(a.woff2) format("woff2");`);
  });
});

describe("isFontsourceCss", () => {
  it("matches @fontsource stylesheets on either path style, nothing else", () => {
    expect(isFontsourceCss("C:\\repo\\node_modules\\@fontsource\\inter\\400.css")).toBe(true);
    expect(isFontsourceCss("/repo/node_modules/.pnpm/@fontsource+inter@5/node_modules/@fontsource/inter/400-italic.css")).toBe(true);
    expect(isFontsourceCss("/repo/node_modules/@fontsource/inter/400.css?inline")).toBe(false);
    expect(isFontsourceCss("/repo/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff")).toBe(false);
    expect(isFontsourceCss("/repo/packages/theme/halloween.css")).toBe(false);
  });
});

describe("inlineRule", () => {
  it("never inlines replay art and leaves everything else to Vite's default", () => {
    expect(inlineRule("/repo/assets/replay/forge/moth-widow/eye_l.socket.png")).toBe(false);
    expect(inlineRule("C:\\repo\\assets\\replay\\thumbs\\malakor.webp")).toBe(false);
    expect(inlineRule("/repo/assets/plates/root-vault.webp")).toBeUndefined();
    expect(inlineRule("/repo/assets/characters/malakor/rig/head.regions.webp")).toBeUndefined();
  });
});

describe("the LCP preload", () => {
  it("names the image the landing's cellar renders with fetchPriority high", () => {
    const cellar = readFileSync(new URL("./src/landing/Cellar.tsx", import.meta.url), "utf8");
    expect(cellar).toContain(`from "../../../../${LCP_IMAGE}"`);
    expect(cellar).toMatch(/fetchPriority="high"/);
  });

  it("preloads the image on the landing only, as a high-priority WebP image", () => {
    const run = (pathname: string) => {
      const added: Record<string, unknown>[] = [];
      const document = { createElement: () => ({}), head: { appendChild: (el: Record<string, unknown>) => added.push(el) } };
      new Function("location", "document", lcpPreloadScript("/assets/root-vault-x.webp"))({ pathname }, document);
      return added;
    };
    expect(run("/")).toEqual([{ rel: "preload", as: "image", type: "image/webp", fetchPriority: "high", href: "/assets/root-vault-x.webp" }]);
    for (const path of ["/characters", "/overlay", "/studio", "/embed", "/creator/new"]) expect(run(path), path).toEqual([]);
  });

  it("finds the emitted file of a source by its original name", () => {
    const assets = [
      { fileName: "assets/paper-1.webp", originalFileNames: ["assets/plates/paper.webp"] },
      { fileName: "assets/root-vault-D6m.webp", originalFileNames: ["C:\\repo\\assets\\plates\\root-vault.webp"] },
    ];
    expect(emittedName(assets, LCP_IMAGE)).toBe("assets/root-vault-D6m.webp");
    expect(emittedName(assets, "assets/plates/missing.webp")).toBeUndefined();
  });
});
