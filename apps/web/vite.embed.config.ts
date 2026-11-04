// The standalone <sr-avatar> script (spec avatar-reach, design "Embed"): `vite build -c
// vite.embed.config.ts` writes dist/embed/sr-avatar.js next to the app build (which runs first;
// emptyOutDir false keeps it). One ES module, everything inlined; React is not imported by the
// entry, so it is not in the file.
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/embed",
    emptyOutDir: false,
    // Library mode keeps whitespace and module comments in ES output; this is a script tag, minify it all.
    rolldownOptions: { output: { minify: true } },
    lib: {
      entry: "src/reach/embed/entry.ts",
      formats: ["es"],
      fileName: () => "sr-avatar.js",
    },
  },
});
