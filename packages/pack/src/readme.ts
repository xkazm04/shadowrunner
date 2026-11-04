// README.txt inside a pack, and the pack's download name (design "API").
import { PACK_EXTENSION, type PackLicence, type PackManifest } from "./types.js";

export const PACK_FORMAT_DOC = "https://github.com/xkazm04/shadowrunner/blob/main/docs/pack-format.md";

/** The human name of each licence. */
export const LICENCE_LABELS: Readonly<Record<PackLicence, string>> = {
  "all-rights-reserved": "All rights reserved",
  "CC-BY-4.0": "CC BY 4.0",
  "CC-BY-NC-4.0": "CC BY-NC 4.0",
  "CC0-1.0": "CC0",
};

const LICENCE_TERMS: Readonly<Record<PackLicence, string>> = {
  "all-rights-reserved": "All rights reserved. Ask the author before you share or reuse this character.",
  "CC-BY-4.0": "Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).",
  "CC-BY-NC-4.0": "Creative Commons Attribution-NonCommercial 4.0 (https://creativecommons.org/licenses/by-nc/4.0/).",
  "CC0-1.0": "CC0 1.0, no rights reserved (https://creativecommons.org/publicdomain/zero/1.0/).",
};

/** The README.txt written into a pack. */
export function packReadme(manifest: PackManifest): string {
  const lines = [
    `${manifest.name} - a Shadowrunner avatar pack`,
    "",
    "A .srpack file is a zip holding one animated character: rig.json (the layered rig), files/",
    "(its layer images, region maps and expression faces) and pack.json (the manifest: saved look,",
    "voice, licence and author). Open it with Import pack in the Shadowrunner creator, or load it",
    "in your own app with @sr/pack.",
    "",
    `Character: ${manifest.name} (${manifest.id})`,
    `Licence: ${LICENCE_LABELS[manifest.licence]}. ${LICENCE_TERMS[manifest.licence]}`,
    `Author: ${manifest.author ?? "not given"}`,
    `Exported: ${manifest.exportedAt}`,
  ];
  if (manifest.fictional === true) lines.push("", "This character is fictional. Any resemblance to a real person is coincidental.");
  lines.push("", `Format: ${PACK_FORMAT_DOC}`, "");
  return lines.join("\n");
}

/** `<slug of name>.srpack`: lower-case ASCII, other characters to `-`, at most 60, `character` when empty. */
export function packFileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug === "" ? "character" : slug}${PACK_EXTENSION}`;
}
