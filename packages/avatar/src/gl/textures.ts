// Textures for the extra images a rig draws (character-control): region index maps (nearest
// sampling, never filtered or mipmapped, so an index never blends with its neighbour) and face
// patches (filtered like their layer). Uploaded once per file when its image is first ready (see
// render/assets.ts); a map in `RigAssets` is ready at `setRig`, a patch the first time its family
// is on. Companion-lanes adds "flow": a morph's motion image and sway map, data rather than colour,
// uploaded as stored (no premultiply, no colour-space conversion) and sampled linear without mipmaps.
import type { AssetCache, AssetImage } from "../render/assets.js";

export type TextureRole = "layer" | "map" | "patch" | "flow";

export interface GlTexture {
  texture: WebGLTexture;
  /** 1 / texture size. */
  texel: [number, number];
}

/** Pixel size of an image asset. */
export function sizeOf(image: AssetImage): [number, number] {
  const natural = "naturalWidth" in image && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  return [Math.max(1, natural[0] ?? 1), Math.max(1, natural[1] ?? 1)];
}

/**
 * Uploads one image: layers and patches premultiplied and mipmapped; maps as stored, nearest; flows
 * as stored, linear (the unpack state is put back to premultiplied, browser colour space after).
 */
export function uploadImage(gl: WebGL2RenderingContext, image: AssetImage, role: TextureRole): GlTexture {
  const map = role === "map";
  const raw = map || role === "flow";
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !raw);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (raw) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  if (raw) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, map ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, map ? gl.NEAREST : gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  } else {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const [w, h] = sizeOf(image);
  return { texture, texel: [1 / w, 1 / h] };
}

export interface TextureStore {
  /** The texture for `file` once its image is ready (uploading it then), else undefined. */
  get(file: string, role: "map" | "patch" | "flow"): GlTexture | undefined;
  /** Textures uploaded by this store. */
  uploads(): number;
  dispose(): void;
}

export function createTextureStore(gl: WebGL2RenderingContext, images: AssetCache): TextureStore {
  const textures = new Map<string, GlTexture>();
  let uploads = 0;
  return {
    get(file, role) {
      const known = textures.get(`${role}:${file}`);
      if (known !== undefined) return known;
      const image = images.get(file);
      if (image === undefined) return undefined;
      const made = uploadImage(gl, image, role);
      gl.bindTexture(gl.TEXTURE_2D, null);
      textures.set(`${role}:${file}`, made);
      uploads += 1;
      return made;
    },
    uploads: () => uploads,
    dispose() {
      for (const { texture } of textures.values()) gl.deleteTexture(texture);
      textures.clear();
      images.dispose();
    },
  };
}
