"""BiRefNet (MIT) matte per frame of video.mp4 -> alpha.webm (VP9, yuva420p, Opus audio)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..ffmpeg import FrameWriter, read_frames
from ..fetch import require

SIZE = 1024  # BiRefNet's native input
BATCH = 4
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
_STD = np.array([0.229, 0.224, 0.225], np.float32)


class Matter:
    def __init__(self, device: str = "cuda") -> None:
        import torch
        from transformers import AutoModelForImageSegmentation

        self.torch = torch
        self.device = device
        model = AutoModelForImageSegmentation.from_pretrained(str(require("birefnet")), trust_remote_code=True)
        self.dtype = torch.float16 if device == "cuda" else torch.float32
        self.model = model.to(device=device, dtype=self.dtype).eval()

    def mattes(self, frames: list[np.ndarray]) -> list[np.ndarray]:
        """RGB uint8 frames (any size, all equal) -> uint8 mattes of the same size."""
        torch = self.torch
        h, w = frames[0].shape[:2]
        x = torch.from_numpy(np.stack(frames)).to(self.device).permute(0, 3, 1, 2).float() / 255.0
        x = torch.nn.functional.interpolate(x, size=(SIZE, SIZE), mode="bilinear", align_corners=False)
        mean = torch.tensor(_MEAN, device=self.device).view(1, 3, 1, 1)
        std = torch.tensor(_STD, device=self.device).view(1, 3, 1, 1)
        x = ((x - mean) / std).to(self.dtype)
        with torch.inference_mode():
            pred = self.model(x)[-1].sigmoid().float()
        pred = torch.nn.functional.interpolate(pred, size=(h, w), mode="bilinear", align_corners=False)
        out = (pred.clamp(0, 1) * 255.0 + 0.5).to(torch.uint8).squeeze(1).cpu().numpy()
        return list(out)

    def close(self) -> None:
        del self.model
        if self.device == "cuda":
            self.torch.cuda.empty_cache()


def write_alpha(video: Path, out: Path, size: tuple[int, int] = (1080, 1080), fps: float = 30.0,
                log: Path | None = None) -> int:
    """Matte every frame of `video`; returns the frame count."""
    matter = Matter()
    codec = [
        "-map", "0:v", "-map", "1:a?",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
        "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0",
        "-c:a", "libopus", "-b:a", "128k", "-shortest",
    ]
    n = 0
    try:
        with FrameWriter(out, size, fps, "rgba", codec, ["-i", str(video)], log=log) as fw:
            batch: list[np.ndarray] = []

            def flush() -> None:
                for rgb, a in zip(batch, matter.mattes(batch)):
                    fw.write(np.dstack([rgb, a]))
                batch.clear()

            for frame in read_frames(video, size):
                batch.append(frame)
                n += 1
                if len(batch) == BATCH:
                    flush()
            if batch:
                flush()
    finally:
        matter.close()
    return n


def decoded_alpha(webm: Path, index: int = 0, size: tuple[int, int] = (1080, 1080)) -> np.ndarray:
    """Frame `index` of an alpha WebM as RGBA, decoded with libvpx-vp9 (ffmpeg's native vp9
    decoder drops the alpha plane)."""
    for i, frame in enumerate(read_frames(webm, size, pix_fmt="rgba", decoder="libvpx-vp9",
                                          max_frames=index + 1)):
        if i == index:
            return frame
    raise ValueError(f"{webm} has fewer than {index + 1} frames")
