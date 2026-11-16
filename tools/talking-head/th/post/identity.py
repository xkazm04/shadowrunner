"""Identity: DINOv2-small (Apache-2.0) CLS embeddings of face crops, cosine against the portrait."""

from __future__ import annotations

import numpy as np

from ..fetch import require

CROP = 224
MARGIN = 0.15  # around the landmark extent, so the hairline and jaw are in the crop


class Embedder:
    def __init__(self, device: str = "cuda") -> None:
        import torch
        from transformers import AutoImageProcessor, AutoModel

        d = str(require("dinov2"))
        self.torch = torch
        self.device = device
        self.proc = AutoImageProcessor.from_pretrained(d)
        self.model = AutoModel.from_pretrained(d).to(device).eval()

    def embed(self, crops: list[np.ndarray]) -> np.ndarray:
        """RGB uint8 crops -> L2-normalised CLS embeddings, (N, 384)."""
        out = []
        for i in range(0, len(crops), 32):
            inputs = self.proc(images=list(crops[i:i + 32]), return_tensors="pt").to(self.device)
            with self.torch.inference_mode():
                cls = self.model(**inputs).last_hidden_state[:, 0].float()
            out.append(self.torch.nn.functional.normalize(cls, dim=-1).cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, 384), np.float32)

    def close(self) -> None:
        del self.model
        if self.device == "cuda":
            self.torch.cuda.empty_cache()


def summarise(cosines: np.ndarray) -> dict[str, float | None]:
    if cosines.size == 0:
        return {"mean": None, "min": None, "p5": None}
    return {
        "mean": round(float(cosines.mean()), 4),
        "min": round(float(cosines.min()), 4),
        "p5": round(float(np.percentile(cosines, 5)), 4),
    }
