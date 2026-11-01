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
import { RESIDENT, type OnAirCharacter } from "./cast";

/** The rig's layer images only: the source portrait and the depth map are not drawn. */
const PNG_URLS = import.meta.glob<string>(
  ["../../../../assets/characters/malakor/rig/*.png", "!../../../../assets/characters/malakor/rig/{portrait,depth}.png"],
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
    const rig = result.value.rig;
    const urls = new Map(Object.entries(PNG_URLS).map(([path, url]) => [fileOf(path), url]));
    const assets: RigAssets = {};
    await Promise.all(
      rig.layers.map(async (layer) => {
        if (layer.file === undefined) return;
        const url = urls.get(layer.file);
        if (url === undefined) throw new Error(`Malakor is missing ${layer.file}`);
        const image = new Image();
        image.src = url;
        await image.decode();
        assets[layer.file] = image;
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
