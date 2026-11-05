// Lets plain `node` (24, native type stripping) run the director's TypeScript: workspace packages
// import their siblings as `./x.js`, which exists only as `./x.ts`. A relative `.js` specifier that
// does not resolve is retried as `.ts`; everything else resolves as Node would.
//   node --import ./src/hooks.mjs src/cli.ts ...
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (relative && specifier.endsWith(".js") && error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
