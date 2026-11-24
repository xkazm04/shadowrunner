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
- umT5-XXL is loaded straight into bf16 (upstream's load leaves it fp32 and the pipeline's
  working dtype follows it), encodes the take's prompt and negative prompt once, and is released;
  the pipeline gets the cached embeddings and an empty stand-in module (11 GB less host memory).
- `offload`: the one `pipeline.to(cuda)` becomes diffusers' enable_model_cpu_offload (T5, CLIP, the
  DiT and the VAE take the GPU in turn), as in the Flash driver.
- `cfgSplit`: the transformer runs the three CFG branches one by one (batch 1) instead of as one
  batch of 3, so a 125-frame window fits in 24 GB without spilling into shared memory.
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


_forward = infer_preview.WanTransformerAudioMask3DModel.forward


def _split_forward(self, x, t, context, seq_len, clip_fea=None, y=None, **kw):
    """The three CFG branches (negative text, no audio, full) one at a time instead of as a batch
    of 3: the same arithmetic per sample, a third of the activation memory (a batch of 3 at
    624 x 928 x 125 frames spills past 24 GB into shared memory and crawls)."""
    if x.shape[0] == 1:
        return _forward(self, x, t, context, seq_len, clip_fea=clip_fea, y=y, **kw)
    text, audio, latent_t, ip_mask, scale = context
    outs = []
    for i in range(x.shape[0]):
        ctx = ([text[i]], audio[i:i + 1], latent_t,
               None if ip_mask is None else ip_mask[i:i + 1], scale)
        outs.append(_forward(self, x[i:i + 1], t[i:i + 1], ctx, seq_len,
                             clip_fea=None if clip_fea is None else clip_fea[i:i + 1],
                             y=None if y is None else y[i:i + 1], **kw))
    return torch.cat(outs, 0)


_t5_load = infer_preview.WanT5EncoderModel.from_pretrained
_EMBEDS = {}


class _NoT5(torch.nn.Module):
    """What the pipeline keeps in place of umT5 once the prompts are encoded: an empty module (the
    offload hooks still find a module) that reports bf16, the working dtype the pipeline reads
    from `text_encoder.dtype`."""

    def __init__(self):
        super().__init__()
        # one tiny parameter: accelerate's offload hook reads the previous module's parameters
        self._probe = torch.nn.Parameter(torch.zeros(1, dtype=torch.bfloat16), requires_grad=False)

    @property
    def dtype(self):
        return torch.bfloat16

    def forward(self, *a, **k):
        raise RuntimeError("th: umT5 was released after the prompts were encoded")


def _prompt_text():
    c = CFG["config"]
    names = c["test_name_list"]
    with open(os.path.join(c["base_dir"], "prompts", f"{names[0]}.txt"), encoding="utf-8") as f:
        return f.read()


def _t5_encode_once(*a, **k):
    """umT5-XXL (11 GB bf16) is only needed for two prompts. infer_preview loads it without
    low_cpu_mem_usage, so its torch_dtype is not applied (fp32, 22 GB) and the pipeline's working
    dtype, read from text_encoder.dtype, follows it; and diffusers' model offload keeps it in host
    memory for the whole render. Here it is loaded straight into bf16, encodes the take's prompt and
    negative prompt on the GPU (nothing else is there yet), and is dropped: the pipeline gets the
    cached embeddings and an empty stand-in, which frees 11 GB of host memory for the render."""
    from omegaconf import OmegaConf
    from transformers import AutoTokenizer

    k["low_cpu_mem_usage"] = True
    m = _t5_load(*a, **k).to(torch.bfloat16).eval().to("cuda")
    c = CFG["config"]
    tc = OmegaConf.load(c["config_path"])["text_encoder_kwargs"]
    tok = AutoTokenizer.from_pretrained(os.path.join(c["model_name"],
                                                     tc.get("tokenizer_subpath", "tokenizer")))
    ns = types.SimpleNamespace(tokenizer=tok, text_encoder=m, _execution_device="cuda")
    prompt, negative = _prompt_text(), c.get("negative_prompt") or ""
    with torch.no_grad():
        for key, text in (("prompt", prompt), ("negative", negative)):
            e = P._get_t5_prompt_embeds(ns, prompt=[text], device="cuda", dtype=torch.bfloat16)
            _EMBEDS[key] = [u.cpu() for u in e]
    _EMBEDS["text"] = prompt
    del m, ns
    torch.cuda.empty_cache()
    print("th: prompts encoded with umT5-XXL (bf16) and the encoder released", flush=True)
    return _NoT5()


_mask_latents = P.prepare_mask_latents


def _mem(tag):
    if torch.cuda.is_available():
        print(f"th: {tag}: {torch.cuda.memory_allocated() / 2**30:.1f} GiB allocated, "
              f"{torch.cuda.max_memory_allocated() / 2**30:.1f} GiB peak", flush=True)


def _cached_encode(self, prompt, negative_prompt=None, do_classifier_free_guidance=True,
                   num_videos_per_prompt=1, prompt_embeds=None, negative_prompt_embeds=None,
                   max_sequence_length=512, device=None, dtype=None):
    text = prompt[0] if isinstance(prompt, list) else prompt
    if text != _EMBEDS["text"] or num_videos_per_prompt != 1:
        raise SystemExit("th: only the take's own prompt was encoded")
    dev = device or self._execution_device
    out = tuple([u.to(dev, dtype or torch.bfloat16) for u in _EMBEDS[k]]
                for k in ("prompt", "negative"))
    _mem("prompt embeddings from the cache")
    return out


def _mask_latents_logged(self, *a, **k):
    out = _mask_latents(self, *a, **k)
    _mem("masked clip encoded")
    return out


class _Config(infer_preview.Config):
    def __init__(self):
        super().__init__()
        for k, v in CFG["config"].items():
            if not hasattr(self, k):
                raise SystemExit(f"th: upstream Config has no '{k}'")
            setattr(self, k, v)
        print(f"th: config {json.dumps(CFG['config'])}", flush=True)


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
    P.encode_prompt = _cached_encode
    infer_preview.WanT5EncoderModel = types.SimpleNamespace(from_pretrained=_t5_encode_once)
    P.prepare_mask_latents = _mask_latents_logged
    infer_preview.Config = _Config
    if int(CFG.get("audioChunk") or 0) > 0:
        infer_preview.extract_audio_features = _chunked_features
    if CFG.get("cfgSplit"):
        if CFG["config"].get("enable_teacache"):
            raise SystemExit("th: cfgSplit counts three transformer calls per step; TeaCache off")
        infer_preview.WanTransformerAudioMask3DModel.forward = _split_forward
    infer_preview.main()
