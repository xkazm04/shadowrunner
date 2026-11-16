"""NVIDIA Video Super Resolution (Maxine VFX SDK) through NVIDIA's own Python bindings, `nvidia-vfx`.

Terms (read 2026-11-16, in the wheel's dist-info/licenses): NVIDIA Software License Agreement
(v. May 5, 2025) + Product-Specific Terms for NVIDIA AI Products, models under the NVIDIA Open Model
License (24 Oct 2025). The wheel is public on pypi.nvidia.com (no account, no login), Windows and Linux,
and NGC states the VSR effect "is available for commercial/non-commercial use". Binding limits: no
redistribution outside a Customer Product, no reverse engineering, and SLA 8.9: benchmark results may
not be disclosed to third parties without NVIDIA's written permission (keep A/B numbers internal).

The wheel is ~436 MB, so it is not installed by `th live`: `python -m th.live.upscale.maxine fetch`
(run with the env's python) downloads the wheel for that python, pinned by sha256, and unpacks it
into $TH_HOME/models/live-upscale/nvvfx-<tag>/, which this module puts on sys.path. An env with
`nvidia-vfx` pip-installed works too.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

from .weights import download, read_rows, upscale_dir, write_rows

if TYPE_CHECKING:
    import torch

VERSION = "0.2.0.0"
INDEX = "https://pypi.nvidia.com/nvidia-vfx/"
WHEELS = {  # (python tag, platform) -> (wheel file, sha256 from the index)
    ("cp310", "win32"): ("nvidia_vfx-0.2.0.0-cp310-cp310-win_amd64.whl",
                         "19933666e3f5e325631ab7d8dd4c07146e729ef5a125d316525075a9bcec58fb"),
    ("cp312", "win32"): ("nvidia_vfx-0.2.0.0-cp312-abi3-win_amd64.whl",
                         "cebaa12411f7e22b39293205c5c4d07b8073d14ca1e0e7727ee4375207a36445"),
    ("cp310", "linux"): ("nvidia_vfx-0.2.0.0-cp310-cp310-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl",
                         "1dc6afbe4ee15e49995ffd1a9e2c441eea0ed9c0794d6fc05d95e090d6782d16"),
    ("cp312", "linux"): ("nvidia_vfx-0.2.0.0-cp312-abi3-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl",
                         "0252866a7b798a6f92c8543443d88f716e8c5bbc6a7ddd77a2754728dada9fa8"),
}
LICENCE = ("NVIDIA Software License Agreement (2025-05-05) + Product-Specific Terms for NVIDIA AI "
           "Products; VSR models under the NVIDIA Open Model License (2025-10-24). Commercial use per "
           "NGC; benchmark results not to be disclosed to third parties without NVIDIA's permission "
           "(SLA 8.9); PyPI status Alpha")
QUALITY = "HIGHBITRATE_HIGH"  # live frames come straight from the VAE (no codec), see the doc's A/B


def _tag() -> tuple[str, str]:
    py = "cp312" if sys.version_info >= (3, 12) else f"cp3{sys.version_info.minor}"
    return py, "win32" if sys.platform == "win32" else "linux"


def target_dir() -> Path:
    return upscale_dir() / f"nvvfx-{_tag()[0]}"


def fetch() -> Path:
    """Download and unpack the nvidia-vfx wheel for this python (436 MB); idempotent."""
    tag = _tag()
    if tag not in WHEELS:
        raise RuntimeError(f"maxine: no nvidia-vfx {VERSION} wheel for {tag}")
    name, sha = WHEELS[tag]
    out = target_dir()
    if not (out / "nvvfx" / "__init__.py").is_file():
        whl = download(INDEX + name, upscale_dir() / "wheels" / name, sha)
        with zipfile.ZipFile(whl) as z:
            z.extractall(out)
    row = {"name": f"nvidia-vfx {VERSION} ({name})", "licence": LICENCE, "url": INDEX + name,
           "revision": f"sha256:{sha}"}
    if row not in read_rows():
        write_rows([row])
    return out


def _import_nvvfx():
    try:
        import nvvfx  # noqa: F401 - a pip-installed nvidia-vfx wins
    except ImportError:
        d = target_dir()
        if not (d / "nvvfx" / "__init__.py").is_file():
            raise RuntimeError(
                "maxine: nvidia-vfx is not installed; run `python -m th.live.upscale.maxine fetch` "
                "with this env's python (downloads NVIDIA's 436 MB wheel; NVIDIA SLA terms apply)"
            ) from None
        sys.path.insert(0, str(d))
    import nvvfx

    return nvvfx


class MaxineUpscaler:
    """uint8 CUDA (N,H,W,3) -> (N,2H,2W,3) with NVIDIA VSR, one frame per SDK call."""

    kind = "maxine"
    scale = 2

    def __init__(self, quality: str = QUALITY, device: int = 0) -> None:
        self.quality, self.device = quality, device
        self.vsr = None
        self.size: tuple[int, int] | None = None

    def _load(self, h: int, w: int) -> None:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("maxine: needs a CUDA GPU")
        nvvfx = _import_nvvfx()
        if self.vsr is None:
            q = nvvfx.VideoSuperRes.QualityLevel[self.quality]
            self.vsr = nvvfx.VideoSuperRes(quality=q, device=self.device)
        self.vsr.output_width, self.vsr.output_height = w * 2, h * 2
        self.vsr.load()
        self.size = (h, w)

    def warmup(self) -> None:
        import torch

        dummy = torch.zeros((2, 512, 512, 3), dtype=torch.uint8, device=f"cuda:{self.device}")
        self(dummy)
        torch.cuda.synchronize()

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor":
        import torch

        n, h, w, _ = frames.shape
        if self.size != (h, w):
            self._load(h, w)
        stream = torch.cuda.current_stream().cuda_stream
        out = torch.empty((n, h * 2, w * 2, 3), dtype=torch.uint8, device=frames.device)
        x = frames.permute(0, 3, 1, 2).float().div_(255)
        for i in range(n):
            res = self.vsr.run(x[i].contiguous(), stream_ptr=stream)
            y = torch.from_dlpack(res.image)  # SDK-owned buffer: consumed before the next run()
            out[i] = y.clamp(0, 1).mul(255).round().to(torch.uint8).permute(1, 2, 0)
        return out

    def close(self) -> None:
        if self.vsr is not None:
            self.vsr.close()
            self.vsr = None


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        print(f"maxine: nvidia-vfx {VERSION} -> {fetch()}")
    else:
        raise SystemExit("usage: python -m th.live.upscale.maxine fetch")
