"""Host-memory patches shared by the EchoMimicV3 drivers (round 3, after two renders ate the PC's
memory). Copied into the clone as th_hands_mem.py next to th_stream_frames.py; upstream stays
unedited. Measured before: a Flash passage held about 43 GB of host commit for about 17 GB of
weights. Where the rest went, and what replaces it here:

- `state_dict = load_file(...)` in upstream's main stays referenced for the whole run (the 3.7 GB
  DiT): `release_state_dicts` makes load_file return a dict that load_state_dict empties once it
  has been copied into the model.
- `save_videos_grid` turns every frame into a PIL image (plus a colour-transferred copy) before
  writing: `stream_save` writes frame by frame with the same conversion and colour transfer, and
  accepts a `Streamed` result whose frames were already written window by window.
- the whole-clip float32 reference tiling (425 x 3 x 928 x 624 x 4 bytes = 3 GB) becomes a
  one-frame view expanded in time (`expanded_reference`); each window materialises only its own
  frames.
"""

from __future__ import annotations

import gc
import os


class OnceDict(dict):
    """A state dict that may be dropped after its one load_state_dict."""


def release_state_dicts():
    import safetensors.torch as st
    import torch

    if getattr(st, "_th_released", False):
        return
    load, lsd = st.load_file, torch.nn.Module.load_state_dict

    def load_file(*a, **k):
        return OnceDict(load(*a, **k))

    def load_state_dict(self, state_dict, *a, **k):
        out = lsd(self, state_dict, *a, **k)
        if isinstance(state_dict, OnceDict):
            state_dict.clear()
            gc.collect()
        return out

    st.load_file, torch.nn.Module.load_state_dict = load_file, load_state_dict
    st._th_released = True


class Streamed:
    """What a windowed render returns instead of the clip: the frames are already in `path`.
    Slicing (upstream's `sample[:, :, :n]`) returns itself."""

    def __init__(self, path: str, frames: int):
        self.path, self.frames = path, frames

    def __getitem__(self, _):
        return self


def open_writer(path: str, fps: int):
    """imageio's ffmpeg writer with upstream's (imageio.mimsave) defaults."""
    import imageio

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    return lambda: imageio.get_writer(path, fps=fps)


def frame_writer(path: str, fps: int):
    from src.utils import color_transfer
    from th_stream_frames import FrameWriter

    return FrameWriter(open_writer(path, fps), color_transfer)


def write_tensor(videos, w) -> int:
    """(1, 3, T, H, W) float [0, 1] (or uint8) tensor -> frames, one at a time."""
    import numpy as np
    from th_stream_frames import to_uint8

    for i in range(videos.shape[2]):
        f = videos[0, :, i].permute(1, 2, 0).cpu().numpy()
        w.append(f if f.dtype == np.uint8 else to_uint8(f))
    return w.close()


def stream_save(videos, path, rescale=False, n_rows=6, fps=12, imageio_backend=True,
                color_transfer_post_process=True):
    """Drop-in for src.utils.save_videos_grid for one video (batch 1, no rescale)."""
    if isinstance(videos, Streamed):
        os.replace(videos.path, path)
        return
    if rescale or videos.shape[0] != 1 or not color_transfer_post_process:
        raise SystemExit("th: stream_save covers upstream's one call shape only")
    write_tensor(videos, frame_writer(path, fps))
    gc.collect()


def expanded_reference(fn):
    """Wrap get_image_to_video_latent2/3: build the reference for one frame and expand it in time
    (a view, no copy); the mask is rebuilt full length (frame 0 kept, the rest 255), as upstream."""
    import torch

    def wrapped(start, end, video_length, sample_size):
        if end is not None or isinstance(start, list) or video_length <= 1:
            return fn(start, end, video_length=video_length, sample_size=sample_size)
        video, mask, clip = fn(start, end, video_length=1, sample_size=sample_size)
        video = video.expand(-1, -1, video_length, -1, -1)
        full = torch.full((1, 1, video_length) + tuple(mask.shape[3:]), 255.0, dtype=mask.dtype)
        full[:, :, :1] = mask[:, :, :1]
        return video, full, clip

    return wrapped


def free(cuda: bool = True) -> None:
    gc.collect()
    if cuda:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def host_commit_gb() -> float | None:
    """This process's private commit (Windows PrivateUsage), GB; None elsewhere."""
    import ctypes
    import sys

    if sys.platform != "win32":
        return None

    class PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
            (n, ctypes.c_size_t) for n in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]

    c = PMC()
    c.cb = ctypes.sizeof(PMC)
    k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb):
        return None
    return c.PrivateUsage / 2**30


def trace(tag: str) -> None:
    if os.environ.get("TH_HOST_TRACE") == "1":
        gb = host_commit_gb()
        print(f"th: host commit {gb:.1f} GB at {tag}" if gb is not None else f"th: {tag}",
              flush=True)


def traced(fn, tag: str, first: int = 0):
    """Wrap `fn` to print the process commit before and after (all calls, or the first n)."""
    calls = [0]

    def wrapped(*a, **k):
        calls[0] += 1
        on = not first or calls[0] <= first
        if on:
            trace(f"{tag} start")
        out = fn(*a, **k)
        if on:
            trace(f"{tag} end")
        return out

    return wrapped


def strip_module(m) -> None:
    """Empty every parameter and buffer of `m` in place (it keeps its dtype and stays a module,
    so the offload hooks can still move it, now for free)."""
    import torch

    for p in list(m.parameters()) + list(m.buffers()):
        p.data = torch.empty(0, dtype=p.dtype)


def _clone(x):
    if isinstance(x, (list, tuple)):
        return type(x)(_clone(v) for v in x)
    return x.clone() if hasattr(x, "clone") else x


def cached_encode(encode, release: bool):
    """Wrap a pipeline's encode_prompt: the first call runs upstream's encoder exactly as before
    (offload hook, device, dtype), the result is cached per arguments, and with `release` the
    text encoder's weights are emptied afterwards (umT5-XXL: 11 GB of host memory that the offload
    hooks would otherwise move back and forth). A later call with new arguments after a release
    is an error, not a silent re-encode."""
    cache = {}

    def wrapped(self, *a, **k):
        key = repr((a, sorted(k.items())))
        if key not in cache:
            if getattr(self, "_th_t5_released", False):
                raise SystemExit("th: a new prompt after the text encoder was released")
            cache[key] = encode(self, *a, **k)
            if release:
                strip_module(self.text_encoder)
                self._th_t5_released = True
                free()
                trace("text encoder released")
        return _clone(cache[key])

    return wrapped


def cast_after_load(load, dtype_name: str = "bfloat16"):
    """from_pretrained followed straight away by the cast upstream does a line later, with a gc,
    so the fp32 copy is gone before the next model loads."""
    def wrapped(*a, **k):
        import torch

        m = load(*a, **k).to(getattr(torch, dtype_name))
        free(cuda=False)
        return m

    return wrapped
