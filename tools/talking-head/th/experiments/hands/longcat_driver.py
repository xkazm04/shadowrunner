"""th iris-hands driver for LongCat-Video-Avatar 1.6 (INTERNAL COMPARISON ONLY). NOT imported by `th`:
`longcat.write_driver` copies it into the clone as th_hands_longcat.py; it runs in the hands-longcat
venv, one process on one GPU, with upstream's own command line (run_demo_avatar_single_audio_to_
video.py's arguments) after these run-time patches (upstream files unedited):

- one process, no torchrun: RANK/WORLD_SIZE/MASTER_* are set here, `init_process_group` uses gloo
  (NCCL does not exist on Windows) and the context-parallel groups are the 1-rank world (upstream
  builds them with a CUDA DeviceMesh, which needs NCCL);
- no vocal separation: `audio_separator` (and its ONNX UVR model, licence unverified) is replaced
  by a stub, and `separate_vocals` just loads the line at 16 kHz (our lines are clean TTS speech);
- memory (one render under the guard's host cap): umT5-XXL is loaded in bf16 as the demo's first
  model, encodes the take's prompt and upstream's negative prompt on the still-empty GPU and is
  dropped before the INT8 DiT is read (the pipeline gets the cached embeddings); Whisper-large-v3
  stays on the CPU without its unused decoder; the INT8 DiT, its LoRAs and the VAE go to the GPU
  as upstream does;
- the seed: upstream hard-codes `global_seed = 42`; TH_LC_SEED replaces that one line in the
  source as it is compiled (the file on disk is untouched).
"""
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for k, v in {"USE_LIBUV": "0",   # torch's Windows build has no libuv for the TCP store
             "RANK": "0", "WORLD_SIZE": "1", "LOCAL_RANK": "0", "MASTER_ADDR": "127.0.0.1",
             "MASTER_PORT": os.environ.get("TH_LC_PORT", "29517")}.items():
    os.environ.setdefault(k, v)

# --- audio_separator stub (never installed) ---
_sep = types.ModuleType("audio_separator.separator")


class _Separator:
    onnx_execution_provider = ["CPUExecutionProvider"]

    def __init__(self, *a, **k):
        pass

    def load_model(self, *a, **k):
        print("th: vocal separator skipped (clean TTS line)", flush=True)


_sep.Separator = _Separator
_uvr = types.ModuleType("audio_separator.separator.uvr_lib_v5")
_uvr.spec_utils = types.SimpleNamespace(normalize=lambda wave, **k: wave)
sys.modules.update({"audio_separator": types.ModuleType("audio_separator"),
                    "audio_separator.separator": _sep,
                    "audio_separator.separator.uvr_lib_v5": _uvr})

import torch  # noqa: E402
import torch.distributed as dist  # noqa: E402
from longcat_video.context_parallel import context_parallel_util as cpu_  # noqa: E402
from longcat_video.pipeline_longcat_video_avatar import LongCatVideoAvatarPipeline as P  # noqa: E402

_init_pg = dist.init_process_group


def _gloo_init(*a, **k):
    k["backend"] = "gloo"
    return _init_pg(*a[1:] if a else (), **k)


def _single_cp(context_parallel_size=1, global_rank=0, world_size=1):
    if context_parallel_size != 1 or world_size != 1:
        raise SystemExit("th: this driver runs one process on one GPU")
    w = dist.group.WORLD
    cpu_.dp_size = cpu_.cp_size = 1
    cpu_.dp_group = cpu_.cp_group = w
    cpu_.dp_ranks = cpu_.cp_ranks = [0]
    cpu_.dp_rank = cpu_.cp_rank = 0


def separate_vocals(_separator, source_path, sample_rate=16000, batch_size=2, duration=None):
    import librosa

    audio, _ = librosa.load(source_path, sr=sample_rate, mono=True)
    if duration is not None:
        audio = audio[:int(duration * sample_rate)]
    return audio, sample_rate


_to = P.to
_t5 = P._get_t5_prompt_embeds
_audio = P.get_audio_embedding


def _to_keep_encoders(self, device):
    te, self.text_encoder = self.text_encoder, None
    try:
        _to(self, device)
    finally:
        self.text_encoder = te
    return self


_EMB = {}   # prompt text -> (embeddings, mask) on the CPU


class _T5Gone:
    """What the pipeline keeps in place of umT5 once the prompts are encoded: its config (the
    pipeline reads d_model) and its dtype, no weights."""

    dtype = torch.bfloat16

    def __init__(self, config):
        self.config = config

    def to(self, *a, **k):
        return self

    def eval(self):
        return self


def demo_negative(src):
    """upstream's negative prompt, read from the demo's source (a literal inside generate())."""
    import re

    m = re.search(r'negative_prompt = "([^"]+)"', src)
    if not m:
        raise SystemExit("th: the demo's negative prompt was not found; the pinned commit changed")
    return m.group(1)


def _encode_at_load(prompts):
    """The demo's first model load (umT5-XXL): load it in bf16, encode the take's prompt and the
    negative prompt on the GPU (still empty: nothing else is loaded yet), keep the embeddings on
    the CPU and drop the encoder, all before the 15 GB INT8 DiT is read."""

    def load(path, subfolder="text_encoder", torch_dtype=torch.bfloat16, **k):
        import gc

        from transformers import AutoTokenizer, UMT5EncoderModel

        tok = AutoTokenizer.from_pretrained(path, subfolder="tokenizer")
        te = UMT5EncoderModel.from_pretrained(path, subfolder=subfolder,
                                              torch_dtype=torch.bfloat16).eval().to("cuda")
        ns = types.SimpleNamespace(tokenizer=tok, text_encoder=te)
        with torch.no_grad():
            for text in prompts:
                e, m = _t5(ns, [text], 1, 512, "cuda", torch.bfloat16)
                _EMB[text] = (e.cpu(), m.cpu())
        config = te.config
        del te, ns
        gc.collect()
        torch.cuda.empty_cache()
        print(f"th: {len(prompts)} prompts encoded with umT5-XXL (bf16), encoder dropped", flush=True)
        return _T5Gone(config)

    return load


def _t5_cached(self, prompt=None, num_videos_per_prompt=1, max_sequence_length=512, device=None,
               dtype=None):
    text = prompt[0] if isinstance(prompt, list) else prompt
    if text not in _EMB or num_videos_per_prompt != 1 or max_sequence_length != 512:
        raise SystemExit("th: a prompt that was not encoded at load time")
    e, m = _EMB[text]
    return e.to(device=device, dtype=dtype or torch.bfloat16), m.to(device)


def _audio_on_cpu(self, speech_array, fps=32, device="cpu", **kw):
    return _audio(self, speech_array, fps=fps, device="cpu", **kw).to(device)


def _demo_source(path, seed):
    src = open(path, encoding="utf-8").read()
    old = "global_seed = 42"
    if src.count(old) != 1:
        raise SystemExit("th: upstream seed line not found; the pinned commit changed")
    return src.replace(old, f"global_seed = {int(seed)}")


def main():
    dist.init_process_group = _gloo_init
    cpu_.init_context_parallel = _single_cp
    P.to = _to_keep_encoders
    P._get_t5_prompt_embeds = _t5_cached
    P.get_audio_embedding = _audio_on_cpu
    path = os.path.join(HERE, "run_demo_avatar_single_audio_to_video.py")
    demo = types.ModuleType("th_longcat_demo")
    demo.__file__ = path
    src = _demo_source(path, os.environ.get("TH_LC_SEED", "42"))
    exec(compile(src, path, "exec"), demo.__dict__)
    demo.separate_vocals = separate_vocals
    with open(sys.argv[sys.argv.index("--input_json") + 1], encoding="utf-8") as f:
        prompt = json.load(f)["prompt"]
    demo.UMT5EncoderModel = types.SimpleNamespace(
        from_pretrained=_encode_at_load([prompt, demo_negative(src)]))
    _enc = demo.get_audio_encoder

    def _cpu_encoder(*a, **k):
        m = _enc(*a, **k)
        m.to = lambda *_a, **_k: m   # the demo moves it to the GPU; it stays on the CPU
        if getattr(m, "decoder", None) is not None:
            m.decoder = None         # only Whisper's encoder is used (3 GB less)
        return m

    demo.get_audio_encoder = _cpu_encoder
    sys.argv = [path] + sys.argv[1:]
    args = demo._parse_args()
    print(f"th: args {vars(args)}", flush=True)
    demo.generate(args)
    print(f"th: peak allocated {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB", flush=True)


if __name__ == "__main__":
    main()
