// The face projected out of the dark (costume requirement 3.1, 3.3): <AvatarCanvas> from
// @sr/avatar, its gaze on the visitor's torch through a `lookAt` ref (torch.ts gazeAt, written by
// the composition root on pointer move, read by the renderer every frame: no React render per
// move). A lazy chunk (Apparition.tsx), so the renderer and Malakor's layer images load after the
// cellar plate. Malakor comes from his committed rig (assets/characters/malakor/rig) through
// importLegacyLayers, as the avatar bench loads him; the user's own character, once it is on air,
// replaces him (requirement 3.5; the on-air flow is spec voice-and-air).
import { AvatarCanvas, type LookAtRef, type RigAssets } from "@sr/avatar";
import { defaultLook, importLegacyLayers } from "@sr/rig";
import { useEffect, useState, type ReactElement } from "react";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { rigFiles } from "../creator/library/assets";
import { malakorFiles, withSidecars } from "../creator/library/seed";
import { RESIDENT, type OnAirCharacter } from "./cast";

/** The rig's layer images only: the source portrait and the depth map are not drawn. */
const IMAGE_URLS = import.meta.glob<string>(
  "../../../../assets/characters/malakor/rig/*.webp",
  { query: "?url", import: "default", eager: true },
);

function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

let malakor: Promise<OnAirCharacter> | undefined;

/** Malakor's rig and images, loaded once per page. Rejects when the rig or an image is missing. */
export function loadMalakor(): Promise<OnAirCharacter> {
  malakor ??= (async () => {
    const result = importLegacyLayers(layersJson, specJson);
    if (!result.ok) throw new Error(`Malakor did not import: ${result.errors.map((e) => e.message).join("; ")}`);
    // The retrofit's region and face sidecars, when committed (character-control; seed.ts).
    const rig = withSidecars(result.value.rig);
    const urls = new Map(Object.entries(IMAGE_URLS).map(([path, url]) => [fileOf(path), url]));
    const extra = malakorFiles();
    const layerFiles = new Set(rig.layers.map((l) => l.file));
    const assets: RigAssets = {};
    await Promise.all(
      rigFiles(rig).map(async (file) => {
        const url = urls.get(file) ?? (layerFiles.has(file) ? undefined : extra[file]);
        if (url === undefined) {
          if (layerFiles.has(file)) throw new Error(`Malakor is missing ${file}`);
          return;
        }
        const image = new Image();
        image.src = url;
        await image.decode();
        assets[file] = image;
      }),
    );
    return { name: RESIDENT, rig, look: defaultLook(rig), assets };
  })();
  malakor.catch(() => {
    malakor = undefined;
  });
  return malakor;
}

export interface PictureProps {
  className?: string;
  /** The user's character on air; Malakor when absent. */
  character?: OnAirCharacter;
  /** Where the face looks: the torch, in normalised view space. */
  lookAt?: LookAtRef;
}

export default function Picture({ className, character, lookAt }: PictureProps): ReactElement | null {
  const [resident, setResident] = useState<OnAirCharacter | undefined>(undefined);
  useEffect(() => {
    if (character !== undefined) return undefined;
    let live = true;
    loadMalakor().then(
      (m) => {
        if (live) setResident(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [character]);
  const shown = character ?? resident;
  if (shown === undefined) return null;
  return (
    <AvatarCanvas
      rig={shown.rig}
      look={shown.look}
      assets={shown.assets}
      {...(className === undefined ? {} : { className })}
      {...(lookAt === undefined ? {} : { lookAt })}
    />
  );
}
