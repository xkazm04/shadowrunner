"""Adversarial texture term for the Iris sharpener (`train_iris train --gan W`): a small patch
discriminator, trained from scratch next to the net, on 256 px target patches.

Why: with L1 (+ FFT) alone, skin detail the FlashHead VAE destroyed cannot be predicted, so the net
paints the median, a flat skin. A discriminator rewards plausible Iris skin texture instead; the
two-noise-draw consistency term in train_iris keeps that texture from following input noise.
Plain VGG-style patch critic with spectral norm, non-saturating BCE, Adam 1e-4 (0.9, 0.99).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import torch


def build_disc(ch: int = 64):
    from torch import nn
    from torch.nn.utils import spectral_norm as sn

    def block(cin: int, cout: int, stride: int) -> list:
        return [sn(nn.Conv2d(cin, cout, 4 if stride == 2 else 3, stride, 1)), nn.LeakyReLU(0.2, True)]

    layers = [nn.Conv2d(3, ch, 3, 1, 1), nn.LeakyReLU(0.2, True)]
    layers += block(ch, ch, 2) + block(ch, ch * 2, 1) + block(ch * 2, ch * 2, 2)
    layers += block(ch * 2, ch * 4, 1) + block(ch * 4, ch * 4, 2)
    layers.append(nn.Conv2d(ch * 4, 1, 3, 1, 1))  # one logit per ~40 px receptive patch
    return nn.Sequential(*layers)


class GanTerm:
    def __init__(self, device: str = "cuda") -> None:
        import torch

        self.disc = build_disc().to(device)
        self.opt = torch.optim.Adam(self.disc.parameters(), lr=1e-4, betas=(0.9, 0.99))

    def g_loss(self, fake: "torch.Tensor") -> "torch.Tensor":
        """Non-saturating generator loss on the net's output (0..1)."""
        import torch
        from torch.nn import functional as F

        self.disc.requires_grad_(False)
        logits = self.disc(fake * 2 - 1)
        return F.binary_cross_entropy_with_logits(logits, torch.ones_like(logits))

    def d_step(self, fake: "torch.Tensor", real: "torch.Tensor") -> float:
        import torch
        from torch.nn import functional as F

        self.disc.requires_grad_(True)
        lr = self.disc(real * 2 - 1)
        lf = self.disc(fake.detach() * 2 - 1)
        loss = (F.binary_cross_entropy_with_logits(lr, torch.ones_like(lr))
                + F.binary_cross_entropy_with_logits(lf, torch.zeros_like(lf)))
        self.opt.zero_grad(set_to_none=True)
        loss.backward()
        self.opt.step()
        return float(loss)

    def state_dict(self) -> dict:
        return {"disc": self.disc.state_dict(), "opt": self.opt.state_dict()}

    def load_state_dict(self, sd: dict) -> None:
        self.disc.load_state_dict(sd["disc"])
        self.opt.load_state_dict(sd["opt"])
