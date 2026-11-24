"""th iris-hands driver for EchoMimicV3-Flash. NOT imported by `th`: `emv3.write_driver` copies this
file into the clone as th_hands_flash.py and it runs in the hands-emv3 venv. It calls the unedited
upstream `infer_flash.main()` after three opt-in patches, each driven by an environment variable
(plus one fix: a temporary file still held open by moviepy on Windows no longer fails the take):

- TH_EMV3_OFFLOAD=1: the one `pipeline.to(cuda)` becomes diffusers' enable_model_cpu_offload.
- TH_EMV3_TEACACHE=0: TeaCache is not enabled (upstream's --enable_teacache is store_true with
  default True, so the flag cannot turn it off). In this pipeline TeaCache counts the conditional
  and the audio-free call of one step as two steps and may reuse the conditional residual for the
  audio-free call, which weakens the audio guidance on skipped steps.
- TH_EMV3_WINDOW=<n> (with TH_EMV3_OVERLAP=<k>): a clip longer than one window is rendered as
  windows of at most n frames; every window after the first is conditioned on the last k frames
  of the clip so far (the mask keeps them, as upstream's infer_preview.py continues a long clip),
  the CLIP identity image stays the reference, and the k overlapping frames are crossfaded.
- TH_EMV3_AUDIO_CHUNK=<n>: wav2vec features are computed per n-frame chunk (with 1 s of audio
  context on each side, kept only for the chunk's own frames) instead of over the whole line, so a
  long line's features see the few-second context of a training clip.
- TH_EMV3_REANCHOR=<json file> (round 3, with TH_EMV3_WINDOW): {"prompts": [...], "poses": [...]},
  one entry per window (the last repeats): window k is prompted with prompts[k] instead of the
  command line's prompt, and its CLIP identity image becomes the image poses[k] (an open-hands pose
  frame; "" keeps the reference); the motion frames are kept either way. With "endPose": true the
  pose image is also the last frame of every later window, kept by the mask (a keyframe the window
  has to reach), as upstream's end-image conditioning does.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infer_flash  # noqa: E402
import torch  # noqa: E402
from src.pipeline_wan_fun_inpaint_audio_2512 import WanFunInpaintAudioPipeline as P  # noqa: E402
from src.pipeline_wan_fun_inpaint_audio_2512 import WanPipelineOutput  # noqa: E402

_to = P.to
_call = P.__call__


def _offload_to(self, *args, **kwargs):
    dev = kwargs.get("device", args[0] if args else None)
    if os.environ.get("TH_EMV3_OFFLOAD") == "1" and dev is not None and str(dev).startswith("cuda"):
        if not getattr(self, "_th_offloaded", False):
            self.enable_model_cpu_offload(device=dev)
            self._th_offloaded = True
        return self
    return _to(self, *args, **kwargs)


def plan(total, window, overlap):
    """Window starts and lengths: equal strides (a multiple of 4, the VAE's temporal stride) so the
    last window is not a sliver; every length is 4k + 1 when `total` is."""
    if total <= window:
        return [(0, total)]
    count = math.ceil((total - overlap) / (window - overlap))
    stride = math.ceil((total - overlap) / count / 4) * 4
    out, start = [], 0
    while True:
        n = min(stride + overlap, total - start)
        out.append((start, n))
        if start + n >= total:
            return out
        start += n - overlap


def _reanchor():
    path = os.environ.get("TH_EMV3_REANCHOR", "")
    if not path:
        return [], [], False
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    return list(d.get("prompts") or []), list(d.get("poses") or []), bool(d.get("endPose"))


def pick(items, k):
    """The k-th per-window entry; the last one repeats; None when there are none."""
    return items[min(k, len(items) - 1)] if items else None


def _pose(path, like):
    from PIL import Image

    return Image.open(path).convert("RGB").resize(like.size, Image.LANCZOS)


def _windowed(self, prompt, **kw):
    window = int(os.environ["TH_EMV3_WINDOW"])
    overlap = int(os.environ.get("TH_EMV3_OVERLAP", "9"))
    total = kw["num_frames"]
    video, audio = kw["video"], kw["audio_embeds"]
    out = None
    windows = plan(total, window, overlap)
    print(f"th: {total} frames in windows {windows} (overlap {overlap})", flush=True)
    prompts, poses, end_pose = _reanchor()
    for k, (start, n) in enumerate(windows):
        p_k, pose_k = pick(prompts, k) or prompt, pick(poses, k)
        clip_k = _pose(pose_k, kw["clip_image"]) if pose_k else kw["clip_image"]
        if prompts or poses:
            print(f"th: window {k + 1} prompt {p_k[:80]!r}... pose {pose_k or 'reference'}", flush=True)
        v = video[:, :, :n].clone()
        m = torch.full_like(v[:, :1], 255.0)
        m[:, :, :1] = 0
        if out is not None:
            v[:, :, :overlap] = out[:, :, -overlap:].to(v.dtype)
            m[:, :, :overlap] = 0
            if end_pose and pose_k:  # the window must arrive at the pose: its last frame is kept
                import numpy as np

                img = torch.from_numpy(np.array(clip_k)).permute(2, 0, 1)[None, :, None] / 255.0
                v[:, :, -1:] = img.to(v.dtype)
                m[:, :, -1:] = 0
        seg = _call(self, p_k, **{**kw, "num_frames": n, "video": v, "mask_video": m,
                                  "clip_image": clip_k, "audio_embeds": audio[:, start:start + n]}).videos
        if out is None:
            out = seg
        else:
            r = torch.linspace(0, 1, overlap).view(1, 1, -1, 1, 1)
            out[:, :, -overlap:] = out[:, :, -overlap:] * (1 - r) + seg[:, :, :overlap] * r
            out = torch.cat([out, seg[:, :, overlap:]], dim=2)
        print(f"th: window {k + 1}/{len(windows)} done ({out.shape[2]} frames)", flush=True)
    return WanPipelineOutput(videos=out)


_embed = infer_flash.get_audio_embed
AUDIO_MARGIN = 25  # frames of context on each side of a chunk


def _chunked_embed(mel_input, extractor, encoder, video_length, sr=16000, fps=25, device="cpu"):
    chunk = int(os.environ["TH_EMV3_AUDIO_CHUNK"])
    total, spf = int(video_length), sr // fps
    parts = []
    for s in range(0, total, chunk):
        e = min(total, s + chunk)
        a0, a1 = max(0, s - AUDIO_MARGIN), min(total, e + AUDIO_MARGIN)
        emb = _embed(mel_input[a0 * spf:a1 * spf], extractor, encoder, a1 - a0, sr=sr, fps=fps,
                     device=device)
        parts.append(emb[s - a0:s - a0 + (e - s)])
    print(f"th: audio features in {len(parts)} chunks of <= {chunk} frames", flush=True)
    return torch.cat(parts, dim=0)


def _remove_tolerant(path, *a, **k):
    """upstream deletes its temporary mp4 right after moviepy wrote it; on Windows moviepy can
    still hold the handle (WinError 32) and the finished take is lost to the exception."""
    try:
        _remove(path, *a, **k)
    except PermissionError as e:
        print(f"th: left {path} in place ({e})", flush=True)


_remove = os.remove
os.remove = _remove_tolerant
P.to = _offload_to
if os.environ.get("TH_EMV3_TEACACHE") == "0":
    infer_flash.WanTransformer.enable_teacache = lambda self, *a, **k: None
if int(os.environ.get("TH_EMV3_AUDIO_CHUNK", "0") or 0) > 0:
    infer_flash.get_audio_embed = _chunked_embed
if int(os.environ.get("TH_EMV3_WINDOW", "0") or 0) > 0:
    P.__call__ = _windowed
infer_flash.main()
