"""dub-ls runner, executed by the dub-ls arm env's python with cwd = the LatentSync clone. It puts
th/rig/ls_face.py in place of `latentsync.utils.face_detector` BEFORE LatentSync imports it (so the
upstream file, which imports insightface at its top, is never loaded), then:

  ls_run.py sheet --model <face_landmarker.task> --video <mp4> --frames 0,60,120 --out <png>
      the falsification sheet: per frame, the frame with the 3 alignment points and the face box drawn,
      and LatentSync's own aligned 512 crop (ImageProcessor.affine_transform); prints each fit's
      rotation, scale and the crop's mouth row.
  ls_run.py infer --model <task> -- <scripts.inference arguments>
      LatentSync's own scripts/inference.py, unchanged, with the adapter in place.
"""

from __future__ import annotations

import importlib.util
import math
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def install_adapter(model: str) -> None:
    spec = importlib.util.spec_from_file_location("latentsync.utils.face_detector", HERE / "ls_face.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.MODEL_PATH = model
    sys.modules["latentsync.utils.face_detector"] = mod
    sys.path.insert(0, str(Path.cwd()))


def sheet(video: str, frames: list[int], out: str) -> None:
    import cv2
    import numpy as np
    from latentsync.utils.image_processor import ImageProcessor
    from latentsync.utils.util import read_video

    proc = ImageProcessor(512, device="cuda")
    det = proc.face_detector
    all_frames = read_video(video, change_fps=False, use_decord=False)
    rows = []
    for i in frames:
        frame = all_frames[i]
        face, _box, affine = proc.affine_transform(frame)  # what LatentSync feeds its UNet
        crop = face.permute(1, 2, 0).cpu().numpy().astype(np.uint8)
        info = det.last
        shown = frame.copy()
        x1, y1, x2, y2 = info["box"]
        cv2.rectangle(shown, (x1, y1), (x2, y2), (0, 255, 0), 2)
        for (x, y), colour in zip(info["points"], [(255, 0, 0), (0, 0, 255), (255, 255, 0)]):
            cv2.circle(shown, (int(round(x)), int(round(y))), 7, colour, -1)
        m = affine[0].float().cpu().numpy()
        angle = math.degrees(math.atan2(m[1, 0], m[0, 0]))
        scale = math.hypot(m[0, 0], m[1, 0])
        lm = info["landmarks"]
        mouth = lm[[13, 14]].mean(0)  # inner lip midpoint, frame px
        mx, my = m[:, :2] @ mouth + m[:, 2]
        # the 420x560 warp is resized to 512x512 before the UNet
        crop_mouth = (mx * 512 / 420, my * 512 / 560)
        print(f"frame {i}: rotation {angle:+.2f} deg, scale {scale:.4f}, points "
              f"{np.round(info['points'], 1).tolist()}, mouth in crop ({crop_mouth[0]:.1f}, {crop_mouth[1]:.1f})")
        h = 512
        left = cv2.resize(shown, (int(shown.shape[1] * h / shown.shape[0]), h), interpolation=cv2.INTER_AREA)
        guide = crop.copy()
        cv2.line(guide, (0, int(crop_mouth[1])), (511, int(crop_mouth[1])), (255, 0, 255), 1)
        cv2.line(guide, (256, 0), (256, 511), (255, 0, 255), 1)
        cv2.putText(left, f"frame {i}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        cv2.putText(guide, f"rot {angle:+.2f} scale {scale:.3f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        rows.append(np.concatenate([left, guide], axis=1))
    cv2.imwrite(out, cv2.cvtColor(np.concatenate(rows, axis=0), cv2.COLOR_RGB2BGR))
    print(f"sheet -> {out}")


def main(argv: list[str]) -> None:
    mode, rest = argv[0], argv[1:]
    model = rest[rest.index("--model") + 1]
    install_adapter(model)
    if mode == "sheet":
        sheet(rest[rest.index("--video") + 1], [int(v) for v in rest[rest.index("--frames") + 1].split(",")],
              rest[rest.index("--out") + 1])
    elif mode == "infer":
        sys.argv = ["scripts/inference.py", *rest[rest.index("--") + 1:]]
        runpy.run_module("scripts.inference", run_name="__main__")
    else:
        raise SystemExit(f"ls_run: unknown mode {mode}")


if __name__ == "__main__":
    main(sys.argv[1:])
