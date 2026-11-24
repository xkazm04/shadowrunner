"""Pure parts of the LongCat-Video-Avatar 1.6 driver (internal comparison only), split out of
longcat_driver.py: copied into the clone as th_longcat_parts.py and imported there; `th` tests
import them directly (torch only).

- `load_int8_lean`: the INT8 DiT built on the meta device and filled shard by shard (upstream
  builds the whole 13.6B model in fp32 on the CPU first: 54 GB).
- `offload_blocks`: DiT blocks kept on the CPU (pinned masters) and copied to the GPU for their own
  forward only.
- `trace`: this process's private commit at a stage (TH_HOST_TRACE=1). On this WDDM GPU every byte
  of VRAM the process allocates is charged to that commit too (measured: +4.01 GB per 4 GB).
- `demo_negative`: upstream's negative prompt, read from the demo's source.
"""

import json
import os
import sys

import torch


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


def trace(tag):
    """TH_HOST_TRACE=1: this process's private commit (Windows) at a stage."""
    if os.environ.get("TH_HOST_TRACE") != "1" or sys.platform != "win32":
        return
    import ctypes

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
    psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    print(f"th: host commit {c.PrivateUsage / 2**30:.1f} GB at {tag}", flush=True)


def offload_blocks(blocks, count, device="cuda", pin=True):
    """Keep the last `count` transformer blocks on the CPU and bring each to `device` only for its
    own forward. Every tensor keeps one CPU master; the pre-hook points it at a fresh device copy
    and the post-hook back at the master, so the CPU side allocates nothing per step (moving the
    block back with .to("cpu") made a new host copy every forward: +12.8 GB of commit over one
    segment). With 8 distilled steps the transfer is cheap."""
    moved = list(blocks)[len(blocks) - count:] if count else []

    for b in moved:
        b.to("cpu")
        tensors = [t for t in list(b.parameters()) + list(b.buffers())]
        # pinned masters: the async copies read them directly; from pageable memory PyTorch
        # stages every block through its caching pinned-host allocator, a second full copy of
        # the streamed weights on the host (+9.6 GB of commit at the first forward, measured)
        masters = [t.data.pin_memory() if pin else t.data for t in tensors]
        for t, m in zip(tensors, masters):
            t.data = m

        def pre(module, args, _t=tensors, _m=masters):
            for t, m in zip(_t, _m):
                t.data = m.to(device, non_blocking=True, copy=True)

        def post(module, args, output, _t=tensors, _m=masters):
            for t, m in zip(_t, _m):
                t.data = m
            return output

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
