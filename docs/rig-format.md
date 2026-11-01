# Rig v1 format

A **Rig** is the layered 2.5D description of a character's face: a canvas size, a palette and a
stack of PNG layers with pivots. A **Look** is the user's customisation of a rig, stored separately
so a streamer can try looks without re-forging.

The contract is declared once, in `packages/rig/src/types.ts`; the spec of record is
`.kiro/specs/rig-core/design.md` ("Data model"). This page describes the same fields in prose. If
they disagree, the spec wins and this page and the code are fixed to match.

## Wire rules

- `version` is the literal number `1` (`RIG_VERSION`).
- Optional fields are **omitted** when absent. They are never `null`, and the serializer drops
  `undefined` keys.
- Coordinates are canvas pixels, with the origin at the top-left of a `width` x `height` canvas.
- Colours are strings of the form `#rrggbb` (six hex digits).
- External rig JSON is parsed only by `validateRig` (`packages/rig/src/validate.ts`).

## Rig

| field | type | required | meaning |
|---|---|---|---|
| `version` | `1` | yes | Format version. |
| `id` | string | yes | Slug identifying the rig. |
| `name` | string | yes | Display name. |
| `width` | number | yes | Canvas width in px. |
| `height` | number | yes | Canvas height in px. |
| `source` | `"forge"` \| `"replay"` \| `"import"` | yes | Where the rig came from: made by the forge pipeline, served from the replay plane, or converted from a legacy Overlord `layers.json`. |
| `fictional` | `true` | no | Present only on fabricated data. Never written as `false`. |
| `palette` | Palette | yes | The rig's default colours. |
| `layers` | Layer[] | yes | The layer stack. |

## Palette

Four colours, each `#rrggbb`:

| field | meaning |
|---|---|
| `glow` | Main line glow. |
| `eye` | Eye light. |
| `rim` | Rim / line core. |
| `mouth` | Mouth interior. |

## Layer

| field | type | required | meaning |
|---|---|---|---|
| `name` | string | yes | Unique within the rig; characters `[a-z0-9_]` only. |
| `z` | integer | yes | Unique within the rig. Low values are drawn at the back. |
| `kind` | LayerKind | yes | What the layer is; drives animation (see below). |
| `file` | string | yes | PNG file name relative to the rig folder, or a `data:` URL produced by the forge. |
| `bbox` | `[x, y, w, h]` | yes | Where the PNG sits on the canvas, in px. Must lie inside `[0, width] x [0, height]`. |
| `anchor` | `[x, y]` | yes | Pivot point in canvas px; rotation and followers turn about it. |
| `follow` | string | no | Name of a parent layer. The layer inherits the parent's translation and rotation about the parent's anchor. Must name an existing layer, with no cycles. |
| `depth` | number | no | Parallax depth from 0 (background) to 1 (nearest). When omitted, the default for the kind applies. |
| `visible` | `false` | no | Present only when the layer is hidden by default. Never written as `true`. |

### LayerKind and default depth

| kind | default `depth` |
|---|---|
| `static` | 0 |
| `body` | 0.3 |
| `head` | 0.6 |
| `jaw` | 0.62 |
| `eye` | 0.7 |
| `accessory` | 0.75 |
| `crown` | 0.65 |

## Look

| field | type | required | meaning |
|---|---|---|---|
| `palette` | Palette | yes | Colours to render with (starts as the rig's palette). |
| `hidden` | string[] | yes | Names of layers to leave out. Empty array when nothing is hidden. |
| `emotion` | Emotion | yes | Current emotion. |
| `gesture` | Gesture | no | A gesture to play. Omitted when none. |

**Emotion** is one of `"neutral"`, `"amused"`, `"smug"`, `"irritated"`, `"furious"`,
`"delighted"`, `"bored"`, `"suspicious"`, `"grim"`, `"theatrical"`.

**Gesture** is one of `"nod"`, `"tilt"`, `"lean_in"`, `"recoil"`, `"glare"`, `"flare"`.

## Example

A fabricated three-layer rig, with the hidden-by-default and follow fields in use:

```json
{
  "version": 1,
  "id": "example_lich",
  "name": "Example Lich",
  "width": 1024,
  "height": 1024,
  "source": "replay",
  "fictional": true,
  "palette": { "glow": "#7cf2c4", "eye": "#e8fff4", "rim": "#e8fff4", "mouth": "#1a0f24" },
  "layers": [
    {
      "name": "head",
      "z": 0,
      "kind": "head",
      "file": "head.png",
      "bbox": [312, 180, 400, 520],
      "anchor": [512, 640]
    },
    {
      "name": "jaw",
      "z": 1,
      "kind": "jaw",
      "file": "jaw.png",
      "bbox": [400, 560, 224, 160],
      "anchor": [512, 580],
      "follow": "head"
    },
    {
      "name": "monocle",
      "z": 2,
      "kind": "accessory",
      "file": "monocle.png",
      "bbox": [540, 360, 96, 96],
      "anchor": [588, 408],
      "follow": "head",
      "depth": 0.8,
      "visible": false
    }
  ]
}
```

And a Look over it:

```json
{
  "palette": { "glow": "#7cf2c4", "eye": "#e8fff4", "rim": "#e8fff4", "mouth": "#1a0f24" },
  "hidden": [],
  "emotion": "smug",
  "gesture": "tilt"
}
```
