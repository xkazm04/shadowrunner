"""MediaPipe Selfie Segmentation (Apache-2.0 code and model; the 256x256 general .tflite ships in the
mediapipe wheel, so nothing is downloaded). Runs on the CPU via XNNPack, ~4 ms a frame, so it costs
no GPU time beside FlashHead; the colour-guided filter refines its coarse 256 mask on the GPU.

The FlashHead env pins mediapipe 0.10.9, whose legacy `solutions.selfie_segmentation` is used here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import BaseMatte
from .weights import MEDIAPIPE_ROW, record

if TYPE_CHECKING:
    import torch

NATIVE = 256  # the general model's input; its mask is upsampled by mediapipe, we resample back


class SelfieMatte(BaseMatte):
    kind = "mediapipe"

    def __init__(self, res: int = NATIVE, **kw) -> None:
        super().__init__(res=res, **kw)
        self.seg = None

    def _load(self) -> None:
        import mediapipe as mp

        self.seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
        record(MEDIAPIPE_ROW)

    def _infer(self, rgb: "torch.Tensor", frames: "torch.Tensor") -> "torch.Tensor":
        import numpy as np
        import torch
        from torch.nn import functional as F

        host = frames.cpu().numpy()
        masks = np.stack([self.seg.process(np.ascontiguousarray(f)).segmentation_mask for f in host])
        alpha = torch.from_numpy(masks).to(rgb.device).unsqueeze(1)
        if alpha.shape[-1] != self.res:
            alpha = F.interpolate(alpha, size=(self.res, self.res), mode="area")
        return alpha

    def close(self) -> None:
        if self.seg is not None:
            self.seg.close()
            self.seg = None
            self.loaded = False
