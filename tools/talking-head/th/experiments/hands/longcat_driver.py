"""th iris-hands driver for LongCat-Video-Avatar 1.6 (INTERNAL COMPARISON ONLY). NOT imported by `th`:
`longcat.write_driver` copies it into the clone as th_hands_longcat.py; it runs in the hands-longcat
venv, one process on one GPU, with upstream's own command line (run_demo_avatar_single_audio_to_
video.py's arguments) after these run-time patches (upstream files unedited):

- one process, no torchrun: RANK/WORLD_SIZE/MASTER_* are set here, `init_process_group` uses gloo
  (NCCL does not exist on Windows) and the context-parallel groups are the 1-rank world (upstream
  builds them with a CUDA DeviceMesh, which needs NCCL);
- no vocal separation: `audio_separator` (and its ONNX UVR model, licence unverified) is replaced
  by a stub, and `separate_vocals` just loads the line at 16 kHz (our lines are clean TTS speech);
- memory on 24 GB VRAM and about 24 GB of free system commit: umT5-XXL is loaded lazily on the
  CPU at the first prompt (after the INT8 DiT has moved to the GPU), its embeddings are cached per
  prompt and the encoder is released after the first encode; Whisper-large-v3 stays on the CPU
  without its unused decoder; the INT8 DiT, its LoRAs and the VAE go to the GPU as upstream does;
- the seed: upstream hard-codes `global_seed = 42`; TH_LC_SEED replaces that one line in the
  source as it is compiled (the file on disk is untouched).
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for k, v in {"RANK": "0", "WORLD_SIZE": "1", "LOCAL_RANK": "0", "MASTER_ADDR": "127.0.0.1",
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
_T5_CACHE = {}


def _to_keep_encoders(self, device):
    te, self.text_encoder = self.text_encoder, None
    try:
        _to(self, device)
    finally:
        self.text_encoder = te
    return self


def _t5_on_cpu(self, prompt=None, num_videos_per_prompt=1, max_sequence_length=512, device=None,
               dtype=None):
    key = (str(prompt), num_videos_per_prompt, max_sequence_length, str(dtype))
    if key not in _T5_CACHE:
        print("th: encoding a prompt on the CPU (umT5-XXL)", flush=True)
        _T5_CACHE[key] = _t5(self, prompt, num_videos_per_prompt, max_sequence_length, "cpu", dtype)
    return tuple(t.to(device) for t in _T5_CACHE[key])


class _LazyT5:
    """umT5-XXL (11 GB) loaded on the CPU at its first prompt, not at start-up next to the INT8 DiT
    (15 GB, still on the CPU until it moves to the GPU), and released once the prompts are cached:
    this machine has about 24 GB of free commit."""

    dtype = torch.bfloat16

    def __init__(self, *a, **k):
        from transformers import AutoConfig

        self._args, self._kw, self.m = a, k, None
        self.config = AutoConfig.from_pretrained(*a, **{x: v for x, v in k.items() if x == "subfolder"})

    def __call__(self, *a, **k):
        if self.m is None:
            from transformers import UMT5EncoderModel

            print("th: loading umT5-XXL on the CPU", flush=True)
            self.m = UMT5EncoderModel.from_pretrained(*self._args, **self._kw).eval()
        return self.m(*a, **k)

    def release(self):
        import gc

        self.m = None
        gc.collect()

    def to(self, *a, **k):
        return self

    def eval(self):
        return self


_encode = P.encode_prompt


def _encode_then_release(self, *a, **k):
    out = _encode(self, *a, **k)
    if isinstance(self.text_encoder, _LazyT5):
        self.text_encoder.release()   # the prompt and the negative are cached now
    return out


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
    P._get_t5_prompt_embeds = _t5_on_cpu
    P.get_audio_embedding = _audio_on_cpu
    P.encode_prompt = _encode_then_release
    path = os.path.join(HERE, "run_demo_avatar_single_audio_to_video.py")
    demo = types.ModuleType("th_longcat_demo")
    demo.__file__ = path
    exec(compile(_demo_source(path, os.environ.get("TH_LC_SEED", "42")), path, "exec"),
         demo.__dict__)
    demo.separate_vocals = separate_vocals
    demo.UMT5EncoderModel = types.SimpleNamespace(from_pretrained=_LazyT5)
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
