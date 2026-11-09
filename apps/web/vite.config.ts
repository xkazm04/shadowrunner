// The app build. Load diet (perfection-pass requirement 10), each piece a pure helper below so
// vite.config.test.ts can pin it:
// - fonts: the @fontsource CSS names a woff2 and a woff fallback per face; every browser the app
//   supports takes woff2, so the woff is dropped and never emitted;
// - LCP: the landing's vault plate (landing/Cellar.tsx) is preloaded from index.html's head on
//   `/` only, so its request starts with the HTML instead of after the entry script runs;
// - inlining: committed replay art (assets/replay/**: forge layers, region maps, faces, thumbs) is
//   never inlined as base64, so the cast chunk CH 4 loads carries URLs, not ~700 kB of images.
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

/** The landing's LCP image, as Cellar.tsx imports it (relative to the repo root). */
export const LCP_IMAGE = "assets/plates/root-vault.webp";

const slashed = (path: string): string => path.replaceAll("\\", "/");

/** A @fontsource stylesheet's text without its `url(*.woff) format("woff")` fallbacks. */
export function woff2Only(css: string): string {
  return css.replace(/,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g, "");
}

/** True for a @fontsource stylesheet module id. */
export const isFontsourceCss = (id: string): boolean => /\/@fontsource\/[^?]*\.css$/.test(slashed(id));

/** Vite's `assetsInlineLimit` rule: replay art is never inlined; everything else keeps the default. */
export function inlineRule(file: string): false | undefined {
  return slashed(file).includes("/assets/replay/") ? false : undefined;
}

/**
 * The inline head script that preloads the LCP image on the landing (`/`) only: index.html serves
 * every route (the overlay, the studio, CH 4...), which must not pay for the cellar's plate. It
 * runs while the head is parsed, so the request still starts before the entry script's.
 */
export function lcpPreloadScript(href: string): string {
  const attrs = { rel: "preload", as: "image", type: "image/webp", fetchPriority: "high", href };
  return `if(location.pathname==="/"){var l=document.createElement("link");Object.assign(l,${JSON.stringify(attrs)});document.head.appendChild(l);}`;
}

/** The emitted file name of the asset built from `source` (a repo-relative path), if any. */
export function emittedName(assets: readonly { fileName: string; originalFileNames: readonly string[] }[], source: string): string | undefined {
  return assets.find((a) => a.originalFileNames.some((name) => slashed(name).endsWith(source)))?.fileName;
}

function loadDiet(): Plugin {
  let base = "/";
  return {
    name: "sr-load-diet",
    // Before vite:css, which resolves the url()s and emits the font files.
    enforce: "pre",
    configResolved(config) {
      base = config.base;
    },
    transform(code, id) {
      return isFontsourceCss(id) ? { code: woff2Only(code), map: null } : undefined;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (ctx.bundle === undefined) return undefined;
        const assets = Object.values(ctx.bundle).flatMap((o) => (o.type === "asset" ? [o] : []));
        const file = emittedName(assets, LCP_IMAGE);
        if (file === undefined) throw new Error(`sr-load-diet: ${LCP_IMAGE} was not emitted; update LCP_IMAGE with landing/Cellar.tsx`);
        return [{ tag: "script", attrs: { id: "sr-lcp-preload" }, children: lcpPreloadScript(`${base}${file}`), injectTo: "head" }];
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), loadDiet()],
  build: { assetsInlineLimit: inlineRule },
  // The Playwright visual test (e2e/, `pnpm test:visual`) is not part of `pnpm test`.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
