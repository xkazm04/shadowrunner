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
- the INT8 DiT is built on the meta device and filled shard by shard (`load_int8_lean`); upstream
  first builds the whole 13.6B model in fp32 on the CPU (54 GB), past the guard's 40 GB cap;
- both LoRAs (DMD, OPSD) are held in bf16 instead of fp32 (2.4 GB of VRAM less; upstream's 24 GB
  budget assumes neither LoRA nor display); the INT8 layers cannot take a static merge;
- the last TH_LC_OFFLOAD_BLOCKS (16) of the 48 INT8 DiT blocks stay on the CPU and move to the GPU
  for their own forward only: all on the GPU (17.6 GiB) plus 480p activations and the display
  spills past 24 GB and crawls through shared memory;
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
    n = int(os.environ.get("TH_LC_OFFLOAD_BLOCKS", "16") or 0)
    if n and self.dit is not None:
        offload_blocks(self.dit.blocks, n)
        torch.cuda.empty_cache()
    print(f"th: on the GPU: {torch.cuda.memory_allocated() / 2**30:.1f} GiB allocated "
          f"({n} DiT blocks streamed from the CPU)", flush=True)
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


def params_on_meta():
    """Modules built inside get their parameters on the meta device (each layer's real tensor
    lives only while it is registered), their buffers real: accelerate's init_empty_weights."""
    import contextlib

    @contextlib.contextmanager
    def ctx():
        old = torch.nn.Module.register_parameter

        def reg(self, name, param):
            old(self, name, param)
            if param is not None:
                p = self._parameters[name]
                self._parameters[name] = torch.nn.Parameter(p.to("meta"),
                                                            requires_grad=p.requires_grad)

        torch.nn.Module.register_parameter = reg
        try:
            yield
        finally:
            torch.nn.Module.register_parameter = old

    return ctx()


def load_int8_lean(checkpoint_dir, subfolder="base_model_int8", *, model_cls, ql_cls, skip,
                   **kwargs):
    """upstream load_quantized_dit without its first step, which builds the 13.6B-parameter DiT
    for real in fp32 on the CPU (54 GB) only to replace its Linear layers: here the model and the
    INT8 layers are built on the meta device and every shard is loaded into them with
    assign=True, one shard at a time, so host memory holds the 15 GB of INT8 weights and nothing
    else. Then upstream's cast of the remaining fp32 parameters to bf16."""
    from safetensors.torch import load_file

    qdir = os.path.join(checkpoint_dir, subfolder)
    with open(os.path.join(qdir, "config.json"), encoding="utf-8") as f:
        config = json.load(f)
    for k in ("_class_name", "architectures", "_diffusers_version", "model_max_length"):
        config.pop(k, None)
    config.update(kwargs)
    with params_on_meta():
        model = model_cls(**config)
    with torch.device("meta"):
        swap = {name: ql_cls(m.in_features, m.out_features, bias=m.bias is not None)
                for name, m in model.named_modules()
                if isinstance(m, torch.nn.Linear) and not any(p in name for p in skip)}
    for name, ql in swap.items():
        parent = model
        for part in name.split(".")[:-1]:
            parent = getattr(parent, part)
        setattr(parent, name.split(".")[-1], ql)
    index = os.path.join(qdir, "quantized_model.safetensors.index.json")
    if os.path.exists(index):
        with open(index, encoding="utf-8") as f:
            shards = sorted(set(json.load(f)["weight_map"].values()))
    else:
        shards = sorted(x for x in os.listdir(qdir)
                        if x.endswith(".safetensors") and "index" not in x)
    loaded = set()
    for shard in shards:
        sd = load_file(os.path.join(qdir, shard), device="cpu")
        model.load_state_dict(sd, strict=False, assign=True)
        loaded |= set(sd)
        del sd
    missing = set(model.state_dict()) - loaded
    meta = [n for n, t in list(model.named_parameters()) + list(model.named_buffers())
            if t.is_meta]
    if missing or meta:
        raise SystemExit(f"th: INT8 DiT incomplete: missing {sorted(missing)[:5]}, meta {meta[:5]}")
    model.eval()
    for module in model.modules():
        if isinstance(module, ql_cls):
            continue
        for param in module.parameters(recurse=False):
            if param.dtype == torch.float32:
                param.data = param.data.to(torch.bfloat16)
    return model


def offload_blocks(blocks, count, device="cuda"):
    """Keep the last `count` transformer blocks on the CPU and bring each to `device` only for its
    own forward (a forward pre-hook moves it in, a forward hook moves it back). With 8 distilled
    steps the transfer is cheap; it frees count x ~0.28 GB of VRAM for the activations."""
    moved = list(blocks)[len(blocks) - count:] if count else []

    def pre(module, args, kwargs=None):
        module.to(device)

    def post(module, args, output):
        module.to("cpu")
        return output

    for b in moved:
        b.to("cpu")
        b.register_forward_pre_hook(pre)
        b.register_forward_hook(post)
    return len(moved)


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
    from longcat_video.modules import quantization as q
    from longcat_video.modules.avatar.longcat_video_dit_avatar import (
        LongCatVideoAvatarTransformer3DModel as Dit)

    _load_lora = Dit.load_lora

    def _lora_bf16(self, path, key, *a, **k):
        """the LoRA network in bf16 (upstream keeps it fp32: 2 x 2.4 GB of VRAM); its forward
        casts its input to the LoRA's own dtype"""
        _load_lora(self, path, key, *a, **k)
        self.lora_dict[key].to(torch.bfloat16)

    Dit.load_lora = _lora_bf16
    demo.load_quantized_dit = lambda d, subfolder="base_model_int8", **k: load_int8_lean(
        d, subfolder, model_cls=Dit, ql_cls=q.QuantizedLinear, skip=q.DEFAULT_SKIP_PATTERNS, **k)
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
