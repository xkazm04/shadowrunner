"""`build`: a character dir -> a built dir (design "Builder" steps 1-6)."""
from __future__ import annotations

import os
import re
from pathlib import Path

import cv2
import numpy as np

from . import sheets
from .common import (SIZE, alpha_box, grey, decode, dilate, feather, gauss, json_bytes, png_bytes, read_json, read_rgb,
                     region_mask, webp_bytes, write_bytes)
from .keys import DEFAULT_GATES, FAMILIES, build_key, floor_map, split_parts
from .matte import layers
from .pack import atlas, flow_image
from .regions import index_map
from .register import register
from .shade import Morph, place

LAYER_PAD = 4
SWAY_SCALE = 4


def sharpness(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    """Laplacian variance of `a` over that of `b` inside `mask` (1 = as sharp; below 1 = softer)."""
    la = cv2.Laplacian(grey(a), cv2.CV_32F)[mask]
    lb = cv2.Laplacian(grey(b), cv2.CV_32F)[mask]
    return round(float(la.var() / max(lb.var(), 1e-12)), 3) if mask.any() else 1.0


def sway_map(rule: dict, head_a: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """The sway weight (design "Data", brief B): 0 inside the inner ellipse (face and skull), rising
    to 1 at `reach` times its radii, to the power `gamma`; `zero` regions held at 0, `cap` regions
    held at most `max`, `boost` regions raised to at least `min`; reaching a little past the head's
    edge so a swinging end has room to move into."""
    h, w = shape
    cx, cy, rx, ry = rule["inner"]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    s = np.clip((d - 1.0) / (rule.get("reach", 1.6) - 1.0), 0.0, 1.0) ** rule.get("gamma", 1.5)
    for r in rule.get("boost", []):
        s = np.maximum(s, r["min"] * feather(region_mask(r, shape), 24))
    for r in rule.get("cap", []):
        m = feather(region_mask(r, shape), 24)
        s = s * (1.0 - m) + np.minimum(s, r["max"]) * m
    for r in rule.get("zero", []):
        s = s * (1.0 - feather(region_mask(r, shape), 24))
    reach = gauss(dilate(head_a > 0.02, int(rule.get("margin", 12))).astype(np.float32), 6.0)
    return np.clip(s * reach, 0.0, 1.0).astype(np.float32)


def build(char_dir: Path, out_dir: Path, sheet_dir: Path | None) -> bool:
    recipe = read_json(char_dir / "recipe.json")
    slug = recipe["id"]
    edits = {p.stem: p for p in sorted((char_dir / "edits").glob("*.webp"))}
    portrait = read_rgb(char_dir / "portrait.png")
    assert portrait.shape[:2] == (SIZE, SIZE), "portrait.png must be 1024 x 1024"
    files: dict[str, bytes] = {}

    # 1. Mattes and layers.
    L = layers(portrait, read_rgb(edits[recipe["mattes"]["figure"]]), read_rgb(edits[recipe["mattes"]["head"]]), recipe.get("matte", {}))
    boxes = {}
    decoded = {}
    for name in ("body", "head"):
        x, y, w, h = alpha_box(L[name][..., 3], LAYER_PAD)
        boxes[name] = [x, y, w, h]
        files[f"{name}.webp"] = webp_bytes(L[name][y:y + h, x:x + w], quality=recipe.get("layerQuality", 95))
        decoded[name] = place(decode(files[f"{name}.webp"], "RGBA"), boxes[name], SIZE)
    region_maps: dict[str, dict] = {}
    for name, slots in recipe.get("recolour", {}).items():
        imap, rig_slots, fig = index_map(L[name], slots)
        x, y, w, h = boxes[name]
        files[f"{name}.regions.png"] = png_bytes(imap[y:y + h, x:x + w])
        soft = imap.ndim == 3  # round 5: G = coverage (`regions.soft`)
        region_maps[name] = {"map": f"{name}.regions.png", "slots": rig_slots, "figures": fig, "canvas": imap[..., 0] if soft else imap, "soft": soft}
    files["background.webp"] = webp_bytes(L["background"], quality=92)
    background = decode(files["background.webp"], "RGB")
    head_a = decoded["head"][..., 3]

    # 2-4. Keys.
    noop_reg, noop_warp, noop_shift = register(portrait, read_rgb(edits[recipe["floor"]]))
    floor = floor_map(portrait, noop_reg)
    built, records, refused = [], [], []
    for spec in recipe["keys"]:
        if not re.fullmatch(r"[a-z0-9_]+", spec["id"]):
            raise ValueError(f"recipe key id {spec['id']!r} must match [a-z0-9_]+ (the track keeps its MorphTrack name)")
    for spec in recipe["keys"]:
        k = build_key(spec, portrait, read_rgb(edits[spec["edit"]]), noop_reg, floor, head_a, L["figure"],
                      recipe["regions"][spec["region"]], recipe.get("gates", {}),
                      {"eyes": recipe["eyes"], "irisRadius": recipe.get("irisRadius", 20), "openings": recipe.get("openings", [])})
        rec = k["record"]
        rec["track"], rec["flow"] = spec["track"], spec.get("flow", "none")
        records.append(rec)
        if rec["verdict"] != "ok":
            refused.append({"id": spec["id"], "optional": bool(spec.get("optional")), "reasons": rec.get("reasons", [])})
            continue
        if spec["track"] in FAMILIES and "faceSplitY" in recipe:
            # Round 3: an upper (brows, eyes, upper cheeks) and a lower (mouth, creases, jaw) key,
            # a partition of the whole key by a soft band at the character's cheek line.
            rec["verdict"] = "split"
            rec["parts"] = [f"{spec['id']}_upper", f"{spec['id']}_lower"]
            for part, pk in split_parts(k, recipe["faceSplitY"], recipe.get("faceSplitBand", 24)):
                prec = pk["record"]
                prec["track"], prec["flow"], prec["part"], prec["of"] = spec["track"], spec.get("flow", "none"), part, spec["id"]
                prec["verdict"] = "ok"
                prec.pop("parts", None)
                records.append(prec)
                built.append(({**spec, "id": prec["id"], "part": part}, pk))
            continue
        built.append((spec, k))
    fatal = [r for r in refused if not r["optional"]]

    # 5. Atlas, motion image, sway, rig.
    cells, fields, maxes, flow_keys = [], [], [], []
    for spec, k in built:
        x, y, w, h = k["record"]["bbox"]
        cells.append(np.dstack([k["colour"][y:y + h, x:x + w], k["coverage"][y:y + h, x:x + w]]))
        if k["flow"] is not None:
            fields.append((k["flow"][y:y + h, x:x + w], k["back"][y:y + h, x:x + w], k["reveal"][y:y + h, x:x + w]))
            maxes.append(float(k["record"]["flowMax"]))
            flow_keys.append(spec["id"])
    atlas_img, rects = atlas(cells)
    files["atlas.webp"] = webp_bytes(atlas_img, quality=recipe.get("atlasQuality", 95))
    flow_rects: dict[str, list[int]] = {}
    back_rects: dict[str, list[int]] = {}
    flow_codes = None
    if fields:
        flow_codes, frects, brects = flow_image(fields, maxes)
        files["flow.png"] = png_bytes(flow_codes)
        flow_rects = dict(zip(flow_keys, frects))
        back_rects = dict(zip(flow_keys, brects))

    keys = []
    for (spec, k), cell in zip(built, rects):
        key = {"id": spec["id"], "track": spec["track"]}
        if "at" in spec:
            key["at"] = spec["at"]
        if "part" in spec:
            key["part"] = spec["part"]
        key["bbox"] = k["record"]["bbox"]
        key["cell"] = cell
        if spec["id"] in flow_rects:
            key["flowCell"] = flow_rects[spec["id"]]
            key["flowMax"] = k["record"]["flowMax"]
            key["backCell"] = back_rects[spec["id"]]
        keys.append(key)

    # The shader's fixed point at weight 1 (requirement 3.1), on the files as written.
    gates = {**DEFAULT_GATES, **recipe.get("gates", {})}
    mo = Morph(decoded["head"], decode(files["atlas.webp"], "RGBA"), decode(files["flow.png"], "RGB") if fields else None, keys)
    by_id = {rec["id"]: rec for rec in records}
    for (spec, k), key in zip(built, keys):
        x, y, w, h = key["bbox"]
        got = mo.render({key["id"]: 1.0}, (x, y, w, h))
        want = k["colour"][y:y + h, x:x + w] * head_a[y:y + h, x:x + w, None]
        inside = k["coverage"][y:y + h, x:x + w] > 0.5
        err = float(np.abs(got[..., :3] - want).mean(-1)[inside].mean() * 255) if inside.any() else 0.0
        rec = by_id[spec["id"]]
        rec["weight1"] = round(err, 3)
        # Sharpness: the key as the renderer gets it (decoded cell) against the colour it was cut from.
        cx, cy, cw, ch = key["cell"]
        cell = mo.atlas[cy:cy + ch, cx:cx + cw, :3]
        rec["sharpness"] = sharpness(cell, k["colour"][y:y + h, x:x + w], inside)
        if os.environ.get("PK_DEBUG") and sheet_dir is not None:
            e = np.abs(got[..., :3] - want).mean(-1) * inside
            dbg = np.hstack([got[..., :3], want, np.repeat(np.clip(e * 8, 0, 1)[..., None], 3, 2)])
            sheets.jpg(sheet_dir / f"debug-w1-{spec['id']}.jpg", dbg)
        if err > gates["weight1"]:
            rec["verdict"] = "refused"
            rec.setdefault("reasons", []).append(f"at weight 1 the render misses the key by {err:.2f}/255 (gate {gates['weight1']})")
            refused.append({"id": spec["id"], "optional": bool(spec.get("optional")), "reasons": rec["reasons"]})
    # The two parts together at weight 1 against the whole key (round 3: a partition of unity).
    for fam in FAMILIES:
        pair = [(spec, k) for spec, k in built if spec["track"] == fam and "part" in spec]
        if len(pair) != 2:
            continue
        cov = pair[0][1]["coverage"] + pair[1][1]["coverage"]
        x0 = min(k["record"]["bbox"][0] for _, k in pair)
        y0 = min(k["record"]["bbox"][1] for _, k in pair)
        x1 = max(k["record"]["bbox"][0] + k["record"]["bbox"][2] for _, k in pair)
        y1 = max(k["record"]["bbox"][1] + k["record"]["bbox"][3] for _, k in pair)
        got = mo.render({spec["id"]: 1.0 for spec, _ in pair}, (x0, y0, x1 - x0, y1 - y0))
        want = pair[0][1]["colour"][y0:y1, x0:x1] * head_a[y0:y1, x0:x1, None]
        inside = cov[y0:y1, x0:x1] > 0.5
        err = float(np.abs(got[..., :3] - want).mean(-1)[inside].mean() * 255) if inside.any() else 0.0
        for spec, _ in pair:
            by_id[spec["id"]]["composedWeight1"] = round(err, 3)
        if err > gates["weight1"]:
            refused.append({"id": fam, "optional": False, "reasons": [f"upper + lower at weight 1 miss the whole key by {err:.2f}/255"]})
    fatal = [r for r in refused if not r["optional"]]

    morph = {"layer": "head", "atlas": "atlas.webp"}
    if fields:
        morph["flow"] = "flow.png"
    morph["keys"] = keys
    morph["eyes"] = recipe["eyes"]
    sway = None
    if "sway" in recipe:
        sway = sway_map(recipe["sway"], head_a, (SIZE, SIZE))
        hx, hy, hw, hh = boxes["head"]
        small = cv2.resize(sway[hy:hy + hh, hx:hx + hw], (-(-hw // SWAY_SCALE), -(-hh // SWAY_SCALE)), interpolation=cv2.INTER_AREA)
        files["sway.webp"] = webp_bytes(np.repeat(small[..., None], 3, axis=2), lossless=True)
        morph["sway"] = {"map": "sway.webp", "amp": recipe["sway"]["amp"]}

    r = recipe["rig"]
    rig = {
        "version": 1, "id": slug, "name": recipe["name"], "width": SIZE, "height": SIZE, "source": "replay", "fictional": True,
        "palette": r["palette"],
        "layers": [
            {"name": "background", "z": 1, "kind": "static", "file": "background.webp", "bbox": [0, 0, SIZE, SIZE], "anchor": [SIZE // 2, SIZE // 2]},
            {"name": "body", "z": 2, "kind": "body", "file": "body.webp", "bbox": boxes["body"], "anchor": r["anchors"]["body"]},
            {"name": "head", "z": 3, "kind": "head", "file": "head.webp", "bbox": boxes["head"], "anchor": r["anchors"]["head"]},
        ],
        "mouth": recipe["mouth"],
        "face": r["face"],
        "turn": r["turn"],
        "morph": morph,
    }
    for layer in rig["layers"]:
        if layer["name"] in region_maps:
            layer["regions"] = {"map": region_maps[layer["name"]]["map"], "slots": region_maps[layer["name"]]["slots"],
                                **({"soft": True} if region_maps[layer["name"]]["soft"] else {})}
    fx, fy, fw, fh = recipe.get("faceBox", [300, 200, 424, 460])
    face_in = head_a[fy:fy + fh, fx:fx + fw] > 0.99
    figures_sharp = {"head": sharpness(decoded["head"][fy:fy + fh, fx:fx + fw, :3], portrait[fy:fy + fh, fx:fx + fw], face_in),
                     "keysMin": min((r["sharpness"] for r in records if "sharpness" in r), default=None)}
    figures = {
        "sharpness": figures_sharp,
        "regions": {name: m["figures"] for name, m in region_maps.items()},
        "mattes": L["figures"],
        "floor": {"cornerShift": round(noop_shift, 3), "affine": np.round(noop_warp, 5).tolist(), "meanAbs": round(float(np.abs(noop_reg - portrait).mean() * 255), 3)},
        "layers": {n: boxes[n] for n in boxes},
        "atlas": [int(atlas_img.shape[1]), int(atlas_img.shape[0])],
        "flow": [int(flow_codes.shape[1]), int(flow_codes.shape[0])] if flow_codes is not None else None,
        "bytes": {name: len(data) for name, data in sorted(files.items())},
    }
    report = {"id": slug, "verdict": "ok" if not fatal else "failed", "gates": gates,
              "figures": figures, "keys": records, "refused": refused}
    out_dir.mkdir(parents=True, exist_ok=True)
    write_bytes(out_dir / "report.json", json_bytes(report))
    # 6. Sheets (also for a refused build: they show why).
    if sheet_dir is not None:
        atlas_dec = decode(files["atlas.webp"], "RGBA")
        flow_dec = decode(files["flow.png"], "RGB") if "flow.png" in files else None
        mo = Morph(decoded["head"], atlas_dec, flow_dec, keys)
        under = sheets.straight_over(decoded["body"], background)
        sheets.layer_sheets(sheet_dir, {"head": decoded["head"], "body": decoded["body"]}, recipe.get("inspect", []))
        sheets.seam_sheet(sheet_dir, background, decoded["body"], decoded["head"], recipe.get("seam", [400, 520, 240, 160]))
        sheets.key_strips(sheet_dir, mo, under, SIZE)
        sheets.contact(sheet_dir, mo, under, recipe.get("faceBox", [300, 200, 424, 460]), recipe["name"])
        if sway is not None:
            sheets.sway_sheet(sheet_dir, decoded["head"], sway)
        for name, m in region_maps.items():
            sheets.region_sheet(sheet_dir, name, decoded[name], m["canvas"], recipe.get("inspect", []))
        print(f"build: {slug}: sheets -> {sheet_dir}")
    if fatal:
        print(f"build: {slug}: refused {[r['id'] for r in fatal]}; see {out_dir / 'report.json'}")
        return False
    for name, data in files.items():
        write_bytes(out_dir / name, data)
    write_bytes(out_dir / "job.json", json_bytes({"rig": rig, "built": {"tool": "tools/portrait-keys", "keys": len(keys),
                                                                        "refused": [r["id"] for r in refused], **{k: figures[k] for k in ("atlas", "flow", "bytes")}}}))
    print(f"build: {slug}: {len(keys)} keys, atlas {figures['atlas']}, flow {figures['flow']} -> {out_dir}")

    return True
