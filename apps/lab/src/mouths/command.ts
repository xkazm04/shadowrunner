// `mouths` command (L2's mouth sets): node --import ./apps/lab/src/hooks.mjs apps/lab/src/mouths/main.ts
//   <character> [--placeholder] [--draft] [--model <id>] [--only shape,shape]
// Reads apps/web/public/packs/<character>.srpack, writes var/lab/mouths/<character>/ (manifest.json,
// one PNG per shape, cost.json). Without --placeholder it calls Gemini from Node with GEMINI_API_KEY
// and stops with a sentence when the key is absent; --placeholder draws a deterministic stand-in set
// from the character's own art (no model call, cost 0).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PACKS_DIR, VAR_LAB } from "../director/paths.js";
import { MOUTH_SHAPES, type MouthShape } from "../page/lip/mouth/shapes.js";
import { geminiEditor, type FetchLike, type ImageEditor } from "./gemini.js";
import { generateMouthSet } from "./generate.js";
import { ffmpegImages, type ImageOps } from "./images.js";

export const MOUTHS_USAGE = `usage: mouths <character> [--placeholder] [--draft] [--model <id>] [--only ${MOUTH_SHAPES.slice(1).join(",")}]`;

export interface MouthsArgs {
  character: string;
  placeholder: boolean;
  draft: boolean;
  model?: string;
  only?: MouthShape[];
}

export function parseMouthsArgs(argv: readonly string[]): MouthsArgs {
  let character: string | undefined;
  const out: Omit<MouthsArgs, "character"> = { placeholder: false, draft: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--placeholder") out.placeholder = true;
    else if (a === "--draft") out.draft = true;
    else if (a === "--model" || a === "--only") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value. ${MOUTHS_USAGE}`);
      i += 1;
      if (a === "--model") out.model = v;
      else {
        const shapes = v.split(",").map((s) => s.trim());
        const bad = shapes.find((s) => !(MOUTH_SHAPES as readonly string[]).includes(s));
        if (bad !== undefined) throw new Error(`"${bad}" is not a mouth shape (${MOUTH_SHAPES.join(", ")}).`);
        out.only = shapes as MouthShape[];
      }
    } else if (a !== undefined && !a.startsWith("--") && character === undefined) character = a;
    else throw new Error(`Unknown argument "${a ?? ""}". ${MOUTHS_USAGE}`);
  }
  if (character === undefined) throw new Error(`Name a character (a pack id under apps/web/public/packs). ${MOUTHS_USAGE}`);
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(character)) throw new Error(`"${character}" is not a pack id (lowercase letters, digits, dashes).`);
  return { character, ...out };
}

export interface MouthsDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  images?: ImageOps;
  packsDir?: string;
  outRoot?: string;
}

export async function mouthsCommand(argv: readonly string[], log: (line: string) => void, deps: MouthsDeps = {}): Promise<void> {
  const args = parseMouthsArgs(argv);
  const env = deps.env ?? process.env;
  // The key is checked before anything is read or written, so a missing key costs nothing.
  const editor: ImageEditor | undefined = args.placeholder
    ? undefined
    : geminiEditor({
        apiKey: env.GEMINI_API_KEY,
        draft: args.draft,
        ...(args.model !== undefined ? { model: args.model } : env.SR_IMAGE_MODEL && !args.draft ? { model: env.SR_IMAGE_MODEL } : env.SR_IMAGE_DRAFT_MODEL && args.draft ? { model: env.SR_IMAGE_DRAFT_MODEL } : {}),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      });
  const packPath = join(deps.packsDir ?? PACKS_DIR, `${args.character}.srpack`);
  let packBytes: Uint8Array;
  try {
    packBytes = new Uint8Array(await readFile(packPath));
  } catch {
    throw new Error(`No pack at ${packPath}. Build the cast packs (pnpm dev builds them) or name another character.`);
  }
  const outDir = join(deps.outRoot ?? join(VAR_LAB, "mouths"), args.character);
  const { manifest, cost } = await generateMouthSet({
    character: args.character,
    packBytes,
    outDir,
    images: deps.images ?? ffmpegImages,
    ...(editor === undefined ? {} : { editor }),
    ...(args.only === undefined ? {} : { only: args.only }),
    log,
  });
  log(`mouths: ${args.character}: ${Object.keys(manifest.shapes).length} shape(s), ${manifest.source}${manifest.model === undefined ? "" : ` (${manifest.model})`}, ${cost.calls} call(s), $${cost.usd} -> ${outDir}`);
}
