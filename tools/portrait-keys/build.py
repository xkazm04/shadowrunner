"""Portrait keys (companion-lanes design "Builder"). Two commands:

  python tools/portrait-keys/build.py import --portrait <raw.png> --edits <dir> --noop <raw.png> --out <character dir>
      <dir>/<name>/out.png -> <character dir>/edits/<name>.webp; the portrait -> portrait.png (1024 px, area resize)
  python tools/portrait-keys/build.py import --edits <dir> --only <name> [--only <name>...] --out <character dir>
      only those edits; the portrait and every other edit are left byte for byte as they are
  python tools/portrait-keys/build.py build <character dir> --out <built dir> [--sheets <dir>]
      the layers, the key atlas, the motion image, job.json and report.json; review sheets with --sheets

See README.md.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from portrait_keys.common import SIZE, area_resize, png_bytes, read_rgb, to_u8, webp_bytes, write_bytes  # noqa: E402


def cmd_import(args: argparse.Namespace) -> None:
    out = Path(args.out)
    sources = {p.parent.name: p for p in sorted(Path(args.edits).glob("*/out.png"))}
    if args.only:
        # Single-edit mode: a new stop added to a finished character re-encodes nothing else.
        missing = [n for n in args.only if n not in sources]
        if missing:
            sys.exit(f"import: no {args.edits}/<name>/out.png for {missing}")
        sources = {n: sources[n] for n in args.only}
    else:
        if not args.portrait:
            sys.exit("import: --portrait is required unless --only names the edits to bring in")
        portrait = read_rgb(Path(args.portrait))
        write_bytes(out / "portrait.png", png_bytes(to_u8(area_resize(portrait, (SIZE, SIZE)))))
        if args.noop:
            sources["noop"] = Path(args.noop)
    for name, path in sorted(sources.items()):
        img = read_rgb(path)
        write_bytes(out / "edits" / f"{name}.webp", webp_bytes(area_resize(img, (SIZE, SIZE)), quality=92))
        print(f"import: {name} {img.shape[1]}x{img.shape[0]} -> edits/{name}.webp")
    print(f"import: {len(sources)} edits -> {out}")


def cmd_build(args: argparse.Namespace) -> None:
    from portrait_keys.pipeline import build

    ok = build(Path(args.character), Path(args.out), Path(args.sheets) if args.sheets else None)
    if not ok:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(prog="portrait-keys")
    sub = parser.add_subparsers(dest="cmd", required=True)
    imp = sub.add_parser("import", help="raw portrait and edits -> a character dir")
    imp.add_argument("--portrait", help="the raw portrait (not with --only)")
    imp.add_argument("--edits", required=True, help="a folder of <name>/out.png")
    imp.add_argument("--noop", help="the editor's no-op re-render (the noise floor)")
    imp.add_argument("--only", action="append", help="import only this edit (repeatable); nothing else is touched")
    imp.add_argument("--out", required=True)
    imp.set_defaults(fn=cmd_import)
    bld = sub.add_parser("build", help="a character dir -> a built dir")
    bld.add_argument("character")
    bld.add_argument("--out", required=True)
    bld.add_argument("--sheets", help="where to write the review sheets")
    bld.set_defaults(fn=cmd_build)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
