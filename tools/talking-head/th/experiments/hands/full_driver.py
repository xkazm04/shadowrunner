"""th iris-hands driver for full (non-Flash) EchoMimicV3. NOT imported by `th`: `full.write_driver`
copies this file into the clone as th_hands_full.py and it runs in the hands-emv3 venv with one
argument, the JSON written by `full.config`. It runs the unedited upstream `infer_preview.main()`
after these patches:

- `src.face_detect` is replaced, before upstream imports it, by a stub whose `get_mask_coord`
  returns the face box measured with MediaPipe Face Landmarker on the th side (`facebox.py`), so
  neither `retinaface` nor TensorFlow nor InsightFace weights are ever imported or installed.
- upstream's `Config` (no command line) gets the JSON's `config` values, attribute by attribute:
  paths, seed, steps, text/audio guidance, the negative prompt with `neg_scale`/`neg_steps`, dynamic
  CFG, Long Video CFG with its partial/overlap lengths, TeaCache, shift.
- `offload`: the one `pipeline.to(cuda)` becomes diffusers' enable_model_cpu_offload (T5, CLIP, the
  DiT and the VAE take the GPU in turn), as in the Flash driver.
- `audioChunk` > 0: wav2vec features per chunk of that many video frames (1 s of audio context on
  each side, kept only for the chunk's own frames) instead of over the whole line.
"""
import json
import math
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(sys.argv[1], encoding="utf-8"))
_face = types.ModuleType("src.face_detect")
_face.get_mask_coord = lambda _path: tuple(CFG["face"])
sys.modules["src.face_detect"] = _face

import infer_preview  # noqa: E402
import torch  # noqa: E402
from src.pipeline_wan_fun_inpaint_audio import WanFunInpaintAudioPipeline as P  # noqa: E402

_to = P.to


def _offload_to(self, *args, **kwargs):
    dev = kwargs.get("device", args[0] if args else None)
    if CFG.get("offload") and dev is not None and str(dev).startswith("cuda"):
        if not getattr(self, "_th_offloaded", False):
            self.enable_model_cpu_offload(device=dev)
            self._th_offloaded = True
        return self
    return _to(self, *args, **kwargs)


class _Config(infer_preview.Config):
    def __init__(self):
        super().__init__()
        for k, v in CFG["config"].items():
            if not hasattr(self, k):
                raise SystemExit(f"th: upstream Config has no '{k}'")
            setattr(self, k, v)
        print(f"th: config {json.dumps(CFG['config'], ensure_ascii=False)}", flush=True)


def chunk_spans(total, chunk, margin):
    """(start, end, context start, context end) in video frames for each chunk of a line."""
    out = []
    for s in range(0, total, chunk):
        e = min(total, s + chunk)
        out.append((s, e, max(0, s - margin), min(total, e + margin)))
    return out


AUDIO_MARGIN = 25  # frames of context on each side of a chunk
TOKENS_PER_FRAME = 2  # wav2vec's 20 ms hop at 25 fps (upstream slices audio_embeds by 2 x frame)


def _chunked_features(audio_path, processor, model):
    import librosa

    sr, spf = 16000, 16000 // 25
    audio, _ = librosa.load(audio_path, sr=sr)
    total = math.ceil(len(audio) / spf)
    parts = []
    for s, e, a0, a1 in chunk_spans(total, int(CFG["audioChunk"]), AUDIO_MARGIN):
        seg = audio[a0 * spf:a1 * spf]
        iv = processor(seg, sampling_rate=sr, return_tensors="pt").input_values
        with torch.no_grad():
            f = model(iv).last_hidden_state.squeeze(0)
        want = (e - s) * TOKENS_PER_FRAME
        f = f[(s - a0) * TOKENS_PER_FRAME:(s - a0) * TOKENS_PER_FRAME + want]
        if f.shape[0] < want:  # the conv front end drops a token at the end of a segment
            f = torch.cat([f, f[-1:].expand(want - f.shape[0], -1)], 0)
        parts.append(f)
    print(f"th: audio features in {len(parts)} chunks of <= {CFG['audioChunk']} frames", flush=True)
    return torch.cat(parts, 0)


if __name__ == "__main__":
    P.to = _offload_to
    infer_preview.Config = _Config
    if int(CFG.get("audioChunk") or 0) > 0:
        infer_preview.extract_audio_features = _chunked_features
    infer_preview.main()
