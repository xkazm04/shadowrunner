// @sr/pack wire types: the .srpack format (spec .kiro/specs/avatar-pack, design "Wire types").
import type { Look, Rig } from "@sr/rig";
import type { CharacterSheet } from "./sheet.js";

export const PACK_FORMAT = "srpack";
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 50 * 1024 * 1024;
export const PACK_EXTENSION = ".srpack";
export const PACK_LICENCES = ["all-rights-reserved", "CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0"] as const;
export type PackLicence = (typeof PACK_LICENCES)[number];

/** `pack.json`. Optional fields are omitted, never null. */
export interface PackManifest {
  format: "srpack";
  version: 1;
  app: "shadowrunner";
  /** ISO 8601. */
  exportedAt: string;
  /** Equals rig.id. */
  id: string;
  /** Equals rig.name. */
  name: string;
  look: Look;
  /** A VoiceId when written by Shadowrunner; readers must tolerate others. */
  voice: string;
  licence: PackLicence;
  /** Omitted when empty after trim. */
  author?: string;
  source: Rig["source"];
  /** Present iff rig.fictional. */
  fictional?: true;
  /** The library record's createdAt when known. */
  createdAt?: string;
  /** Who the character is on air (a forged character's approved brief); omitted when none. */
  sheet?: CharacterSheet;
  /** Every image under files/, sorted. */
  files: string[];
}

export interface AvatarPack {
  manifest: PackManifest;
  rig: Rig;
  look: Look;
  voice: string;
  /** The manifest's sheet when it reads (`readSheet`); a sheet that does not read is dropped. */
  sheet?: CharacterSheet;
  /** Keyed by file name; MIME from the extension (png/webp/jpg). */
  files: Record<string, Blob>;
}

export interface PackInput {
  rig: Rig;
  look: Look;
  voice: string;
  files: Record<string, Blob | Uint8Array>;
  licence: PackLicence;
  author?: string;
  createdAt?: string;
  sheet?: CharacterSheet;
  /** Default: now. */
  exportedAt?: string;
}

export type PackErrorCode =
  | "not_a_pack"
  | "newer_version"
  | "bad_manifest"
  | "bad_rig"
  | "bad_look"
  | "missing_file"
  | "too_large"
  | "fetch_failed";

export interface PackError {
  code: PackErrorCode;
  detail: string;
}

export type PackResult = { ok: true; pack: AvatarPack } | { ok: false; error: PackError };
