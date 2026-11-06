// Codex edit requests for the non-human five (cast-face-pass, WP1b):
//   node scripts/cast/five/request.mjs <slug> [--families a,b] [--attempt N] [--closed] [--noop] [--holes e1,e2]
// Faces (`facePrompt`, prompts.mjs) go to var/cast-expr/<slug>/<family>.png (attempt N: <family>.aN.png),
// the closed-eye edit (`CLOSED`) and the no-op re-render (`NOOP`, the noise floor) to var/cast-eyes/<slug>/.
// `--holes` (Lantern Warden): a mask edit OF a face edit (var/cast-expr/<slug>/<e>.png, input <e>.png):
// the openings of its recut eye holes green (`HOLES`), saved as <e>.holes.png: that face's sockets.
// Each request file is run as (about 50-90 s per image):
//   cd <dir> && codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox \
//     -i portrait.<ext> -C . - < <out>.request.txt
// No network, no model: it only writes the requests and prints the commands.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSED, FIVE, HOLES, NOOP, facePrompt } from "./prompts.mjs";

const FAMILIES = ["joy", "showman", "anger", "gloom", "smug", "suspicion"];
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const slug = args.find((a, i) => !a.startsWith("--") && !["--families", "--attempt", "--holes"].includes(args[i - 1]));
if (FIVE[slug] === undefined) throw new Error(`usage: node scripts/cast/five/request.mjs <${Object.keys(FIVE).join("|")}> [--families a,b] [--attempt N] [--closed] [--noop]`);
const attempt = Number(option("--attempt") ?? 0);
const families = option("--families")?.split(",") ?? (args.includes("--closed") || args.includes("--noop") || args.includes("--holes") ? [] : FAMILIES);

const jobDir = join("assets", "replay", "forge", slug);
const job = JSON.parse(readFileSync(join(jobDir, "job.json"), "utf8"));
const ext = job.portrait.split(".").pop();
const briefPath = join("assets", "characters", "cast", slug, "brief.json");
const style = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, "utf8")).style?.name : undefined;

function write(dir, out, prompt, input = `portrait.${ext}`) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(jobDir, job.portrait), join(dir, `portrait.${ext}`));
  const text = `Use your image generation tool to EDIT the attached input image ./${input} (pass it to the tool as the input/reference image). Prompt, verbatim: "${prompt}"\nThen save the result as ${out}.png in this folder and verify the copy. Report whether the tool actually received the input image (yes/no) and the output pixel size.\n`;
  writeFileSync(join(dir, `${out}.request.txt`), text);
  console.log(`${dir.replaceAll("\\", "/")}\t${out}\t${input}`);
}

for (const family of families) {
  if (!FAMILIES.includes(family)) throw new Error(`unknown family ${family}`);
  write(join("var", "cast-expr", slug), attempt === 0 ? family : `${family}.a${attempt}`, facePrompt(slug, family, attempt, style));
}
if (args.includes("--closed")) {
  if (CLOSED[slug] === undefined) throw new Error(`${slug}: no closed edit (its plate reads as closed)`);
  write(join("var", "cast-eyes", slug), "closed", CLOSED[slug]);
}
if (args.includes("--noop")) write(join("var", "cast-eyes", slug), "noop", NOOP);
for (const e of option("--holes")?.split(",") ?? []) write(join("var", "cast-expr", slug), `${e}.holes`, HOLES, `${e}.png`);
