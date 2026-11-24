"""iris-hands round 3 host-memory discipline without a GPU: streamed windows match round 2's
whole-clip stitching frame for frame, the stitcher and writer pieces, the state-dict release and
the expanded reference."""

from __future__ import annotations

from pathlib import Path

from th.experiments.hands import full

HERE = Path(full.__file__).parent


class _Collect:
    """A stand-in for th_hands_mem: frames written are kept in a list."""

    def __init__(self):
        import types

        self.frames: list = []
        self.Streamed = lambda path, n: types.SimpleNamespace(path=path, frames=n)
        self.free = lambda: None

    def frame_writer(self, path, fps):
        outer = self

        class W:
            def append(self, f):
                outer.frames.append(f)

            def close(self):
                return len(outer.frames)

        return W()


def _windowed_ns(call):
    import json

    import torch

    from th.experiments.hands import stream_frames

    src = (HERE / "flash_driver.py").read_text(encoding="utf-8")
    mem = _Collect()
    ns: dict = {"os": __import__("os"), "sys": __import__("sys"), "json": json,
                "math": __import__("math"), "torch": torch, "_call": call, "sf": stream_frames,
                "mem": mem, "WanPipelineOutput": lambda videos: videos}
    exec(src[src.index("def plan("):src.index("_embed = ")], ns)  # noqa: S102
    return ns, mem


def test_flash_windows_keep_motion_frames_and_the_end_pose(tmp_path: Path, monkeypatch) -> None:
    """The windowed call with a stub pipeline: window k > 0 keeps the last 9 frames of the
    previous window (mask 0), gets its own prompt and CLIP pose, and with endPose its last frame
    is the pose, kept; every frame is written once."""
    import json
    import types

    import torch
    from PIL import Image

    seen: list[dict] = []

    def call(_self, prompt, **kw):
        seen.append({"prompt": prompt, **kw})
        n = kw["num_frames"]
        return types.SimpleNamespace(videos=torch.full((1, 3, n, 4, 6), float(len(seen)) / 4))

    ns, mem = _windowed_ns(call)
    pose = tmp_path / "pose.png"
    Image.new("RGB", (6, 4), (255, 0, 0)).save(pose)
    cfg = tmp_path / "r.json"
    cfg.write_text(json.dumps({"prompts": ["a", "b"], "poses": ["", str(pose)], "endPose": True}))
    monkeypatch.setenv("TH_EMV3_WINDOW", "121")
    monkeypatch.setenv("TH_EMV3_OVERLAP", "9")
    monkeypatch.setenv("TH_EMV3_REANCHOR", str(cfg))
    ref = Image.new("RGB", (6, 4), (0, 0, 255))
    out = ns["_windowed"](None, "base", num_frames=225,
                          video=torch.zeros(1, 3, 1, 4, 6).expand(-1, -1, 225, -1, -1),
                          audio_embeds=torch.zeros(1, 225, 5), clip_image=ref)
    assert out.frames == 225 == len(mem.frames) and [s["prompt"] for s in seen] == ["a", "b"]
    assert seen[0]["clip_image"] is ref and seen[1]["clip_image"].getpixel((0, 0)) == (255, 0, 0)
    m1, v1 = seen[1]["mask_video"], seen[1]["video"]
    assert (m1[:, :, :9] == 0).all() and (m1[:, :, 9:-1] == 255).all() and (m1[:, :, -1] == 0).all()
    assert torch.allclose(v1[:, :, :9], torch.full((1,), 0.25)) and v1[0, 0, -1].min() == 1.0
    assert v1[0, 2, -1].max() == 0.0          # the red pose, not the blue reference
    assert (seen[0]["mask_video"][:, :, -1] == 255).all()   # the first window has no end pose


def test_streamed_windows_match_the_whole_clip_stitching(monkeypatch) -> None:
    """Frame for frame the same uint8 video as round 2's whole-clip float32 stitching (crossfade
    over the overlap, torch.cat) followed by upstream's (x * 255).astype(uint8)."""
    import types

    import numpy as np
    import torch

    g = torch.Generator().manual_seed(3)
    segs: list = []

    def call(_self, prompt, **kw):
        segs.append(torch.rand((1, 3, kw["num_frames"], 4, 6), generator=g))
        return types.SimpleNamespace(videos=segs[-1].clone())

    ns, mem = _windowed_ns(call)
    monkeypatch.setenv("TH_EMV3_WINDOW", "121")
    monkeypatch.setenv("TH_EMV3_OVERLAP", "9")
    monkeypatch.delenv("TH_EMV3_REANCHOR", raising=False)
    ns["_windowed"](None, "p", num_frames=425, video=torch.zeros(1, 3, 425, 4, 6),
                    audio_embeds=torch.zeros(1, 425, 5), clip_image=None)
    out = None
    for seg in segs:     # round 2's stitching, verbatim
        if out is None:
            out = seg.clone()
        else:
            r = torch.linspace(0, 1, 9).view(1, 1, -1, 1, 1)
            out[:, :, -9:] = out[:, :, -9:] * (1 - r) + seg[:, :, :9] * r
            out = torch.cat([out, seg[:, :, 9:]], dim=2)
    want = [(out[0, :, i].transpose(0, 1).transpose(1, 2) * 255).numpy().astype(np.uint8)
            for i in range(out.shape[2])]
    assert len(mem.frames) == len(want) == 425
    assert all(np.array_equal(a, b) for a, b in zip(mem.frames, want))


def test_stitcher_and_writer_pieces() -> None:
    import numpy as np

    from th.experiments.hands.stream_frames import FrameWriter, Stitcher, to_uint8

    assert to_uint8(np.array([[[0.0, 0.5, 0.999]]])).tolist() == [[[0, 127, 254]]]
    st = Stitcher(2)
    a, b = np.zeros((5, 1)), np.ones((4, 1))
    first = list(st.push(a))
    assert len(first) == 3 and st.tail().shape == (2, 1)
    second = [float(x[0]) for x in st.push(b)]
    assert second == [0.0, 1.0]          # crossfade r = 0, 1
    assert [float(x[0]) for x in st.finish()] == [1.0, 1.0] and st.tail() is None
    try:
        list(Stitcher(3).push(np.zeros((5, 1))))
        raise AssertionError("short window accepted")
    except ValueError:
        pass

    class W:
        def __init__(self):
            self.got, self.closed = [], False

        def append_data(self, f):
            self.got.append(f)

        def close(self):
            self.closed = True

    w = W()
    fw = FrameWriter(lambda: w, lambda f, ref: f + ref)
    for v in (1, 2, 3):
        fw.append(np.array([v]))
    assert [int(x[0]) for x in w.got] == [1, 3, 4] and fw.close() == 3 and w.closed


def test_state_dict_is_dropped_after_loading(monkeypatch) -> None:
    import safetensors.torch as st
    import torch

    from th.experiments.hands import mem_patches

    monkeypatch.setattr(st, "load_file", lambda *a, **k: {"weight": torch.ones(2, 2),
                                                          "bias": torch.zeros(2)})
    monkeypatch.setattr(torch.nn.Module, "load_state_dict", torch.nn.Module.load_state_dict)
    monkeypatch.delattr(st, "_th_released", raising=False)
    mem_patches.release_state_dicts()
    sd = st.load_file("x")
    lin = torch.nn.Linear(2, 2)
    lin.load_state_dict(sd)
    assert sd == {} and torch.equal(lin.weight, torch.ones(2, 2))
    plain = {"weight": torch.ones(2, 2), "bias": torch.zeros(2)}
    lin.load_state_dict(plain)
    assert len(plain) == 2               # only load_file's dicts are dropped


def test_expanded_reference_is_a_view_with_upstreams_mask() -> None:
    import torch

    from th.experiments.hands import mem_patches

    def fn(start, end, video_length, sample_size):
        v = torch.rand(1, 3, 1, 4, 6).expand(-1, -1, video_length, -1, -1).clone()
        m = torch.zeros(1, 1, video_length, 4, 6, dtype=torch.uint8)
        m[:, :, 1:] = 255
        return v, m, "clip"

    v, m, c = mem_patches.expanded_reference(fn)("img", None, video_length=425, sample_size=[4, 6])
    assert v.shape == (1, 3, 425, 4, 6) and v.stride(2) == 0 and c == "clip"
    assert m.dtype == torch.uint8 and (m[:, :, 0] == 0).all() and (m[:, :, 1:] == 255).all()


def test_full_decodes_to_uint8_only_without_a_crossfade() -> None:
    def cfg(long_cfg, partial, frames):
        return full.config(Path("d"), Path("w"), (1, 2, 3, 4, 5, 6), seed=1, steps=2, text_cfg=4.0,
                           audio_cfg=2.9, negative="", neg_scale=1.0, neg_steps=0,
                           long_cfg=long_cfg, partial=partial, frames=frames)["decodeU8"]

    assert cfg(True, 113, 425) and cfg(False, 125, 125)
    assert not cfg(False, 113, 425)          # upstream crossfades decoded chunks: keep float
    src = (HERE / "full_driver.py").read_text(encoding="utf-8")
    assert 'if CFG.get("decodeU8")' in src and "mem.release_state_dicts()" in src


def test_cached_encode_runs_once_then_empties_the_encoder() -> None:
    import pytest
    import torch

    from th.experiments.hands import mem_patches

    class Pipe:
        def __init__(self):
            self.text_encoder = torch.nn.Linear(4, 4)
            self.calls = 0

    def encode(self, prompt, negative=None, cfg=True):
        self.calls += 1
        w = self.text_encoder.weight
        return [w.sum().reshape(1) + len(prompt)], [w.sum().reshape(1)]

    p = Pipe()
    enc = mem_patches.cached_encode(encode, release=True)
    a = enc(p, "hello", "neg", True)
    b = enc(p, "hello", "neg", True)
    assert p.calls == 1 and torch.equal(a[0][0], b[0][0]) and a[0][0] is not b[0][0]
    assert p.text_encoder.weight.numel() == 0 and p.text_encoder.weight.dtype == torch.float32
    with pytest.raises(SystemExit):
        enc(p, "another prompt", "neg", True)
    keep = Pipe()
    enc2 = mem_patches.cached_encode(encode, release=False)
    enc2(keep, "a")
    enc2(keep, "b")
    assert keep.calls == 2 and keep.text_encoder.weight.numel() == 16


def test_longcat_negative_prompt_is_read_from_the_demo() -> None:
    import pytest

    src = (HERE / "longcat_driver.py").read_text(encoding="utf-8")
    ns: dict = {}
    exec(src[src.index("def demo_negative("):src.index("def _encode_at_load(")], ns)  # noqa: S102
    demo = 'def generate(a):\n    negative_prompt = "Close-up, blurred, extra fingers"\n'
    assert ns["demo_negative"](demo) == "Close-up, blurred, extra fingers"
    with pytest.raises(SystemExit):
        ns["demo_negative"]("nothing here")
    code = src[src.index('"""', 3) + 3:]
    assert code.index("demo.UMT5EncoderModel") < code.index("demo.generate(args)")
