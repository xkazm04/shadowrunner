"""Fit the waist-up reference to a candidate's input size without losing the hands: a wider source
is centre-cropped at the sides (the figure is centred, the sides are backdrop); a taller one is
padded at the sides with the backdrop colour (the top-left corner pixel). Then a Lanczos resize."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


def crop_box(size: tuple[int, int], target: tuple[int, int]) -> tuple[int, int, int, int] | None:
    """The centred side crop that gives `target`'s aspect, or None when the source is taller than
    the target (then it is padded instead). Sizes are (width, height)."""
    w, h = size
    tw, th = target
    if w * th > h * tw:
        cw = round(h * tw / th)
        x = (w - cw) // 2
        return (x, 0, x + cw, h)
    return None


def pad_width(size: tuple[int, int], target: tuple[int, int]) -> int:
    """Total width to add so a taller-than-target source reaches the target aspect."""
    w, h = size
    return max(0, round(h * target[0] / target[1]) - w)


def fit(src: Path, target: tuple[int, int], out: Path) -> Path:
    img = Image.open(src).convert("RGB")
    box = crop_box(img.size, target)
    if box is not None:
        img = img.crop(box)
    else:
        extra = pad_width(img.size, target)
        canvas = Image.new("RGB", (img.width + extra, img.height), img.getpixel((0, 0)))
        canvas.paste(img, (extra // 2, 0))
        img = canvas
    img = img.resize(target, Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out
