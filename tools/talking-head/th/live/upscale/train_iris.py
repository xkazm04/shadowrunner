"""Train the Iris sharpener from scratch (FlashHead env: the data step needs FlashHead's VAE).

    python -m th.live.upscale.train_iris data [--clips 12]         # pairs -> $TH_HOME/live/iris-train
    python -m th.live.upscale.train_iris train [--minutes 150] [--until 01:00] [--resume]

Run with tools/talking-head on PYTHONPATH. Training is not a measurement: it never touches the GPU
lock (only iris_eval takes it, for timed runs). Peak VRAM ~1.4 GB at the default batch (pairs on the host).

- Batch: B LR patches (128 px, 60% centred on the face) of the training clips; targets are rendered on
  the GPU from the source image at 2x (256 px). Online: light blur (p 0.3), noise (p 0.5), gain.
- Loss: L1 + `--fft` (default 0.05) x L1 of the 2D FFT magnitude (keeps fine texture; no pretrained perceptual net, so
  nothing but the project's art shapes the weights) + 0.2 x L1 between the outputs of two noise draws
  of the same patch (noise robustness: freckles must not follow input noise frame to frame).
- `--gan W --init <L1 weights> --lr 1e-4`: fine-tune with iris_gan's patch critic for skin texture.
- Adam 1e-3, cosine to 2e-5 over the time budget, bf16 autocast, EMA 0.999 (the EMA is what ships).
- Validation every `--val-min` minutes on the HOLDOUT edits (still clip and one moving clip, full
  frames): face PSNR/SSIM vs the true 1024 and vs bicubic; the best EMA by face PSNR is written to
  $TH_HOME/models/live-upscale/iris-x2[-tag].pth (latest EMA: iris-x2[-tag]-last.pth). train.jsonl logs every step summary and validation.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import time
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from . import iris
from . import iris_data as D

if TYPE_CHECKING:
    import torch

PATCH = 128
CONSIST = 0.2  # weight of the two-noise-draw consistency term


class Data:
    """Training (or validation) clips on the GPU: LR uint8 frames, their boxes, and source images."""

    def __init__(self, names: list[str], device: str = "cuda") -> None:
        import torch

        self.device = device
        paths = dict(D.sources())
        lrs, self.src, self.idx, traj, flip = [], [], [], [], []
        for s, name in enumerate(names):
            z = np.load(D.data_dir() / f"{name}.npz")
            k = z["lr"].shape[0]
            lrs.append(torch.from_numpy(z["lr"].reshape(-1, D.LR, D.LR, 3)))
            traj.append(torch.from_numpy(z["traj"].reshape(-1, 3)))
            flip.append(torch.from_numpy(np.repeat(z["flip"], D.CLIP)))
            self.idx += [s] * (k * D.CLIP)
            img = torch.from_numpy(D.load_rgb(paths[name])).permute(2, 0, 1)
            self.src.append(img.to(device, torch.float16).div_(255))
        self.lr = torch.cat(lrs).pin_memory()  # (F,512,512,3) uint8 on the host: VRAM stays ~1.6 GB
        self.traj = torch.cat(traj).to(device)
        self.flip = torch.cat(flip).to(device)
        self.srcid = torch.tensor(self.idx, device=device)
        self.names = names

    def __len__(self) -> int:
        return self.lr.shape[0]

    def hr(self, i: int) -> "torch.Tensor":
        """(1,3,1024,1024) float target of frame i."""
        s = self.src[int(self.srcid[i])].float()[None]
        return D.render(s, self.traj[i:i + 1], bool(self.flip[i]))

    def lrf(self, i: int) -> "torch.Tensor":
        return self.lr[i:i + 1].to(self.device).permute(0, 3, 1, 2).float().div_(255)

    def batch(self, n: int, rng: np.random.Generator) -> tuple["torch.Tensor", "torch.Tensor"]:
        import torch

        xs, ys = [], []
        fx0, fy0, fx1, fy1 = D.FACE_BOX_512
        for i in rng.integers(0, len(self), n):
            if rng.random() < 0.6:  # centred on the face (box drifts a little with the clip)
                x = int(rng.integers(fx0 - 40, fx1 - PATCH + 40))
                y = int(rng.integers(fy0 - 40, fy1 - PATCH + 40))
            else:
                x, y = (int(v) for v in rng.integers(0, D.LR - PATCH, 2))
            x, y = min(max(x, 0), D.LR - PATCH), min(max(y, 0), D.LR - PATCH)
            xs.append(self.lrf(int(i))[:, :, y:y + PATCH, x:x + PATCH])
            ys.append(self.hr(int(i))[:, :, 2 * y:2 * (y + PATCH), 2 * x:2 * (x + PATCH)])
        lr, hr = torch.cat(xs), torch.cat(ys)
        gain = torch.empty((n, 1, 1, 1), device=lr.device).uniform_(0.97, 1.03)
        return (lr * gain).clamp_(0, 1), (hr * gain).clamp_(0, 1)


def jitter(lr: "torch.Tensor", gen: "torch.Generator") -> "torch.Tensor":
    """Online degradation on top of the VAE's: light blur (p 0.3), Gaussian noise (p 0.5)."""
    import torch

    n = lr.shape[0]
    u = torch.rand((n, 3), device=lr.device, generator=gen)
    sig = torch.where(u[:, 0] < 0.3, 0.2 + 0.25 * u[:, 1], torch.zeros_like(u[:, 1]))
    out = D.gauss_blur(lr, sig)
    std = torch.where(u[:, 2] < 0.5, torch.rand(n, device=lr.device, generator=gen) * 1.5 / 255,
                      torch.zeros(n, device=lr.device))
    out = out + torch.randn(out.shape, device=lr.device, generator=gen) * std.view(n, 1, 1, 1)
    return out.clamp_(0, 1)


def fft_l1(a: "torch.Tensor", b: "torch.Tensor") -> "torch.Tensor":
    import torch

    fa = torch.fft.rfft2(a.float(), norm="ortho")
    fb = torch.fft.rfft2(b.float(), norm="ortho")
    return (fa.abs() - fb.abs()).abs().mean()


def validate(net, val: Data) -> dict:
    """Face PSNR/SSIM of the net and of bicubic vs the true 1024, frame 4 of each clip in `val`."""
    import torch
    from torch.nn import functional as F

    a, b, c, d = (v * 2 for v in D.FACE_BOX_512)
    rows: dict = {}
    with torch.inference_mode(), torch.autocast("cuda", torch.bfloat16):
        for k, name in enumerate(val.names):
            first = val.idx.index(k)
            per = {"iris": [], "bicubic": []}
            for clip in (0, 1):  # still bust box, then one moving clip
                i = first + clip * D.CLIP + 4
                hr = val.hr(i)[:, :, b:d, a:c]
                lr = val.lrf(i)
                outs = {"iris": net(lr).float().clamp(0, 1),
                        "bicubic": F.interpolate(lr, scale_factor=2, mode="bicubic").clamp(0, 1)}
                for arm, y in outs.items():
                    y = y[:, :, b:d, a:c]
                    per[arm].append((D.psnr(y, hr), D.ssim(D.to_grey255(y) / 255, D.to_grey255(hr) / 255)))
            rows[name] = {arm: [round(float(np.mean([p[j] for p in v])), 4) for j in (0, 1)]
                          for arm, v in per.items()}
    mean = {arm: round(float(np.mean([r[arm][0] for r in rows.values()])), 3) for arm in ("iris", "bicubic")}
    return {"psnr": mean, "perEdit": rows}


def lr_at(frac: float, lr0: float = 1e-3, lr1: float = 2e-5) -> float:
    return lr1 + 0.5 * (lr0 - lr1) * (1 + np.cos(np.pi * min(1.0, frac)))


def deadline(minutes: float, until: str | None) -> float:
    end = time.time() + minutes * 60
    if until:
        h, m = (int(v) for v in until.split(":"))
        now = dt.datetime.now()
        t = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if t <= now:
            t += dt.timedelta(days=1)
        end = min(end, t.timestamp())
    return end


def train(minutes: float, until: str | None, batch: int, val_min: float, resume: bool, seed: int,
          fft: float = 0.05, tag: str = "", gan: float = 0.0, init: Path | None = None, lr0: float = 1e-3) -> Path:
    import torch

    from .iris_gan import GanTerm

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    gen = torch.Generator(device="cuda").manual_seed(seed)
    tr_names = [n for n, _ in D.split()[0]]
    va_names = [n for n, _ in D.split()[1]]
    tr, va = Data(tr_names), Data(va_names)
    work = D.data_dir()
    sfx = f"-{tag}" if tag else ""
    log = open(work / f"train{sfx}.jsonl", "a", encoding="utf-8", newline="\n")
    last = work / f"ckpt-last{sfx}.pt"
    out = iris.weights_path().with_name(f"iris-x2{sfx}.pth")

    net = (iris.load_net(init) if init else iris.build_net()).cuda().to(memory_format=torch.channels_last)
    ema = copy.deepcopy(net).eval().requires_grad_(False)
    opt = torch.optim.Adam(net.parameters(), lr=lr_at(0, lr0), betas=(0.9, 0.99))
    adv = GanTerm() if gan > 0 else None
    step, spent, best = 0, 0.0, -1.0
    if resume and last.is_file():
        ck = torch.load(str(last), map_location="cuda", weights_only=False)
        net.load_state_dict(ck["net"])
        ema.load_state_dict(ck["ema"])
        opt.load_state_dict(ck["opt"])
        step, spent, best = ck["step"], ck["spent"], ck["best"]
        if adv is not None and "gan" in ck:
            adv.load_state_dict(ck["gan"])
    end = deadline(minutes, until)
    budget = spent + max(0.0, end - time.time())  # seconds of training the schedule spans
    head = {"event": "start", "at": dt.datetime.now().isoformat(timespec="seconds"), "train": tr_names,
            "val": va_names, "trainFrames": len(tr), "arch": iris.ARCH, "batch": batch, "patch": PATCH,
            "budgetS": round(budget), "resumeStep": step, "fft": fft, "consistW": CONSIST,
            "gan": gan, "init": str(init) if init else None, "lr0": lr0}
    print(json.dumps(head), flush=True)
    log.write(json.dumps(head) + "\n")
    t_val = t_ckpt = time.time()
    t_mark, run_l = time.time(), []
    while time.time() < end:
        now = time.time()
        frac = spent / budget if budget else 1.0
        for g in opt.param_groups:
            g["lr"] = lr_at(frac, lr0)
        lr, hr = tr.batch(batch, rng)
        xa, xb = jitter(lr, gen), jitter(lr, gen)
        x = torch.cat([xa, xb]).contiguous(memory_format=torch.channels_last)
        with torch.autocast("cuda", torch.bfloat16):
            y = net(x).float()
        ya, yb = y[:batch], y[batch:]
        l1 = (ya - hr).abs().mean() + (yb - hr).abs().mean()
        lf = fft_l1(ya, hr) + fft_l1(yb, hr)
        lc = (ya - yb).abs().mean()
        loss = l1 + fft * lf + CONSIST * lc
        lg = ld = 0.0
        if adv is not None:
            g_term = adv.g_loss(ya)
            loss = loss + gan * g_term
            lg = float(g_term)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        if adv is not None:
            ld = adv.d_step(ya, hr)
        with torch.no_grad():
            for pe, pn in zip(ema.parameters(), net.parameters()):
                pe.lerp_(pn, 1 - 0.999)
        step += 1
        run_l.append((float(l1), float(lf), float(lc), lg, ld))  # syncs: `spent` is GPU time, not launch time
        spent += time.time() - now
        if time.time() - t_mark > 60:
            m = np.mean(run_l, 0)
            row = {"step": step, "spentS": round(spent), "lr": round(lr_at(frac, lr0), 7), "l1": round(m[0] / 2, 5),
                   "fft": round(m[1] / 2, 5), "consist": round(m[2], 5),
                   "ganG": round(m[3], 4), "ganD": round(m[4], 4),
                   "itPerS": round(len(run_l) / (time.time() - t_mark), 2),
                   "vramMiB": torch.cuda.max_memory_allocated() >> 20}
            log.write(json.dumps(row) + "\n")
            log.flush()
            print(json.dumps(row), flush=True)
            t_mark, run_l = time.time(), []
        if time.time() - t_val > val_min * 60:
            t_val = time.time()
            best = _validate(ema, va, step, spent, best, log, out)
        if time.time() - t_ckpt > 300:
            t_ckpt = time.time()
            _ckpt(last, net, ema, opt, adv, step, spent, best)
    best = _validate(ema, va, step, spent, best, log, out)
    _ckpt(last, net, ema, opt, adv, step, spent, best)
    log.write(json.dumps({"event": "end", "at": dt.datetime.now().isoformat(timespec="seconds"),
                          "step": step, "bestPsnr": best}) + "\n")
    log.close()
    if out == iris.weights_path():
        iris.record_licence(out)
    return out


def _ckpt(path: Path, net, ema, opt, adv, step: int, spent: float, best: float) -> None:
    import torch

    ck = {"net": net.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(),
          "step": step, "spent": spent, "best": best}
    if adv is not None:
        ck["gan"] = adv.state_dict()
    torch.save(ck, str(path))


def _validate(ema, va: Data, step: int, spent: float, best: float, log, out: Path) -> float:
    v = validate(ema, va)
    row = {"event": "val", "step": step, "spentS": round(spent), **v}
    if v["psnr"]["iris"] > best:
        best = v["psnr"]["iris"]
        iris.save(ema, out, {"step": step, "valPsnr": v["psnr"], "trainedOn": "Iris art", "holdout": list(D.HOLDOUT)})
        row["saved"] = True
    iris.save(ema, out.with_name(out.stem + "-last.pth"), {"step": step, "valPsnr": v["psnr"]})  # latest EMA
    log.write(json.dumps(row) + "\n")
    log.flush()
    print(json.dumps(row), flush=True)
    return best


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m th.live.upscale.train_iris")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("data")
    d.add_argument("--clips", type=int, default=12)
    d.add_argument("--seed", type=int, default=1116)
    t = sub.add_parser("train")
    t.add_argument("--minutes", type=float, default=150)
    t.add_argument("--until", help="local HH:MM to stop by")
    t.add_argument("--batch", type=int, default=16)
    t.add_argument("--val-min", type=float, default=10)
    t.add_argument("--resume", action="store_true")
    t.add_argument("--seed", type=int, default=1116)
    t.add_argument("--fft", type=float, default=0.05, help="weight of the FFT-magnitude (texture) loss")
    t.add_argument("--gan", type=float, default=0.0, help="weight of the adversarial texture term (iris_gan)")
    t.add_argument("--init", type=Path, help="start from these weights (e.g. the L1 model, for a GAN fine-tune)")
    t.add_argument("--lr", type=float, default=1e-3, help="peak learning rate (cosine to 2e-5)")
    t.add_argument("--tag", default="", help="variant: iris-x2-<tag>.pth, train-<tag>.jsonl, ckpt-last-<tag>.pt")
    a = p.parse_args(argv)
    if a.cmd == "data":
        meta = D.build(D.data_dir(), a.clips, a.seed)
        print(f"train_iris: {len(meta['sources'])} sources -> {D.data_dir()}")
    else:
        out = train(a.minutes, a.until, a.batch, a.val_min, a.resume, a.seed, a.fft, a.tag, a.gan, a.init, a.lr)
        print(f"train_iris: -> {out}")


if __name__ == "__main__":
    main()
