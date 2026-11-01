# Preset characters: image prompts

Five presets that stand next to Arch-Lich Malakor in the cellar listings (CH 4) and the creator.
Each one teaches a different part of the rig, so a visitor who browses them learns what the forge
can animate: hat, hair, a hinged jaw, a crown, glowing eyes and mouth.

## How to use these prompts
- **Through the forge (preferred).** Each `Character` text is under 400 characters, which is the limit of
  `portraitPrompt(t)` in `.kiro/specs/forge-pipeline/design.md`. Running it through the real
  pipeline gives a portrait, a rig and a recorded job for the replay plane in one go.
- **Directly (Gemini 3 Pro Image).** Send `HOUSE_STYLE` + `STYLE_ANCHOR` + the character text, with
  `assets/characters/malakor/rig/portrait.png` attached as the style reference, at 1:1 / 1024 px.
- Rules from `.kiro/steering/product.md` hold: original fiction, not a real person, horror but
  not gore, no text or logos. Each preset is checked by eye against those before it is promoted.
- Record each generation in `docs/provenance.md` (tool, date, prompt file).

`HOUSE_STYLE` is the exact string in forge-pipeline design.md "Prompts (exact)".

`STYLE_ANCHOR` (direct generation only):
> Match the attached reference portrait's style: stylised painterly realism with faceted,
> flat-planed shading, hard rim light, a limited palette of muted darks with exactly one glowing
> accent colour, the character filling the frame from the crown to mid-chest, near-black
> #050505 background, no floor, no props behind the figure.

## 1. The Lantern Warden
- **Teaches:** `hat` and a lit `jaw`. The hat sways on its own layer, and the jaw opens to show the candle inside.
- **Accent:** ember amber `#ffb347`.
- **Expected parts:** head, jaw, eye_l, eye_r, hat, torso.
- **Persona hook:** the night watchman of the root cellar. He counts the gourds every hour, and one is always missing.

**Character:**
> A watchman whose head is a rotting carved gourd, mottled orange and moss-green, flecked with
> white mould. Two triangular eye holes burn with steady amber candlelight. The lower rind is cut
> as a separate hinged jaw with ragged carved teeth, lit from inside. A wide-brimmed, moth-eaten
> felt hat sits low. Shoulders in a damp oilcloth coat with a brass lantern hook at the collar.

## 2. Sister Vesper of the Drowned Choir
- **Teaches:** `hair` as a drifting layer. The hair floats as if underwater while the face holds still, and the eyes glow cold.
- **Accent:** drowned blue `#b9cdf2`.
- **Expected parts:** head, jaw, eye_l, eye_r, hair, torso.
- **Persona hook:** she sang in a chapel that the river took. She still keeps the hours, and asks chat to hum along.

**Character:**
> A drowned choir sister, pale grey-blue skin smooth as river stone, eyes clouded milk-white with
> a faint cold blue glow. Long black hair floats upward and outward as if underwater, framing the
> face in slow strands. Her mouth is closed and solemn, the jaw clearly defined. A high collar of
> wet white lace over a dark habit. Tiny silver bubbles drift around her hair.

## 3. The Understudy
- **Teaches:** a hinged `jaw` (the clearest lip-sync of the five) and a worn `accessory`.
- **Accent:** carmine `#ff4a33`.
- **Expected parts:** head, jaw, eye_l, eye_r, accessory, torso.
- **Persona hook:** a theatre marionette left in the wings for a century. It knows every line of every play and is waiting for its cue.

**Character:**
> A theatre marionette loose of its strings: cracked ivory porcelain face, faded rose cheeks,
> glass eyes with a dim carmine glow. The jaw is a separate hinged wooden piece, two straight
> seams running down from the mouth corners. A small tarnished brass bell hangs on a ribbon
> across the brow. A deep crimson velvet theatre coat with gold piping and a white ruff.

## 4. The Moth Widow
- **Teaches:** `crown`. Tall feathered antennae sway on their own layer, and the large eyes catch the light.
- **Accent:** lunar gold `#e9c46a`.
- **Expected parts:** head, jaw, eye_l, eye_r, crown, torso.
- **Persona hook:** she keeps the lamps the cellar forgot. She collects small confessions the way other moths collect light.

**Character:**
> A moth-woman of the night garden: a soft face of pale dusty fur, two large dark compound eyes
> with a moonlit gold sheen, a small closed mouth with a delicate lower jaw. Two tall feathered
> antennae rise from the brow like a crown. Folded speckled wings wrap her shoulders like a
> mourning cloak, dusted with silver scales. A string of tiny lunar pearls at the throat.

## 5. The Announcer of Dead Air
- **Teaches:** a face made only of light. The eyes and mouth glow out of darkness. It also has a hood (`hat`) and a floating antenna ring (`crown`). It is the broadcast theme made flesh.
- **Accent:** ultraviolet `#b48cff`.
- **Expected parts:** head, jaw, eye_l, eye_r, hat, crown, torso.
- **Persona hook:** it reads the station identification between programmes that were never scheduled. It speaks only in the third person, and only on the hour.

**Character:**
> A tall hooded announcer whose face is a void of soft darkness: only two round eyes of violet
> phosphor and a wide mouth of flickering static-white teeth on a separate lower jaw. A deep hood
> of heavy black felt, frayed at the edge. Above the hood floats a broken ring of rusted antenna
> rods crackling with violet sparks. A collar of old microphone mesh.

## Roster check
| Preset | Signature layer | Accent | Silhouette |
|---|---|---|---|
| Arch-Lich Malakor | crown shards, monocle | teal + orange ring | skull, high collar |
| Lantern Warden | hat, lit jaw | amber | wide brim |
| Sister Vesper | floating hair | drowned blue | hair halo |
| The Understudy | hinged jaw, bell | carmine | ruff |
| The Moth Widow | antennae crown | lunar gold | wings |
| Announcer of Dead Air | glow-only face, hood, antenna ring | ultraviolet | tall hood |

The accents don't repeat. Each silhouette reads differently as a thumbnail, and every layer kind the forge
cuts appears in at least one preset.
