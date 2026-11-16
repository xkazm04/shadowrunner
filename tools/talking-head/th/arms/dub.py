"""`dub-ls`: the product player with every behaviour live but the mouth held at rest (the "plate",
captured like the baseline), then LatentSync 1.6 (ByteDance, code Apache-2.0, weights OpenRAIL++-M)
repaints the lower face from the wav over its own 512 px aligned face crop.

LatentSync's face alignment uses InsightFace buffalo_l (non-commercial). It is replaced by a MediaPipe
Face Landmarker adapter (th/rig/ls_face.py, Apache-2.0; Director ruling 2026-11-16) loaded in place of
`latentsync.utils.face_detector` by th/rig/ls_run.py; the UNet, VAE and whisper are stock.
insightface is never installed: fetch() writes the arm env's requirements from upstream's minus
insightface, onnxruntime-gpu (insightface's runtime) and gradio (the demo UI).

TH_DUB_PASTE (th/rig/dub_paste.py): "mouth" (default) keeps only LatentSync's lower face, feathered
over the plate; "crop" keeps LatentSync's own paste of its whole aligned crop (softens the upper face
too). raw.mp4 is the pasted result; ls-raw.mp4 is LatentSync's own output."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from ..paths import TOOL_DIR
from ..schema import Weight
from .base import Arm, ArmEnv, ArmNotBuilt, FrameCallback, Job, RawResult, read_licences, write_licences

ARM = "dub-ls"
REPO = "https://github.com/bytedance/LatentSync"
REV = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
WEIGHTS_REPO = "ByteDance/LatentSync-1.6"
WEIGHTS_REV = "c42c7e6c8e9c213626389fa7d9a3c444b8536353"
VAE_REPO = "stabilityai/sd-vae-ft-mse"
DROPPED = ("insightface", "onnxruntime-gpu", "gradio")
RUNNER = TOOL_DIR / "th" / "rig" / "ls_run.py"
SHEET_FRAMES = (0, 60, 120)
NOTE = "LatentSync 1.6 with MediaPipe face alignment (InsightFace buffalo_l replaced: non-commercial)"
OPENRAIL_NOTE = ("OpenRAIL++-M: use is bound by the licence's use restrictions (Attachment A), "
                 "which pass on to any derivative and any output's distribution")


def _env() -> ArmEnv:
    return ArmEnv(ARM)


def stripped_requirements(text: str) -> str:
    """Upstream requirements.txt without DROPPED (comments and index lines kept), torch and
    torchvision pinned to their cu121 builds so no index can hand over a CPU wheel."""
    keep = []
    for line in text.splitlines():
        name = line.split("==")[0].split(">=")[0].strip().lower()
        if name in ("torch", "torchvision") and "==" in line and "+" not in line:
            line = line.strip() + "+cu121"
        if name not in DROPPED:
            keep.append(line)
    return "\n".join(keep) + "\n"


def _mediapipe_task() -> Path:
    from ..fetch import require

    return require("mediapipe") / "face_landmarker.task"


def _checkpoints(env: ArmEnv) -> Path:
    return env.models / "checkpoints"


class DubArm(Arm):
    id = ARM

    def fetch(self) -> list[Weight]:
        from huggingface_hub import snapshot_download

        from ..rig.capture import build_packs

        env = _env()
        env.clone(REPO, REV)
        env.models.mkdir(parents=True, exist_ok=True)
        req = env.models / "requirements.th.txt"
        req.write_text(stripped_requirements((env.repo / "requirements.txt").read_text(encoding="utf-8")),
                       encoding="utf-8", newline="\n")
        env.make_venv("3.10", [str(req)], "--index-strategy", "unsafe-best-match")
        ck = _checkpoints(env)
        snapshot_download(WEIGHTS_REPO, revision=WEIGHTS_REV, local_dir=str(ck),
                          allow_patterns=["latentsync_unet.pt", "whisper/tiny.pt"])
        vae_rev = snapshot_download(VAE_REPO).replace("\\", "/").rstrip("/").split("/")[-1]
        link = env.repo / "checkpoints"
        if not link.exists():  # LatentSync reads checkpoints/ relative to its cwd
            if sys.platform == "win32":
                subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(ck)], check=True, capture_output=True)
            else:
                link.symlink_to(ck, target_is_directory=True)
        build_packs()
        rows = [
            Weight(name=WEIGHTS_REPO, licence=f"OpenRAIL++-M ({OPENRAIL_NOTE})",
                   url=f"https://huggingface.co/{WEIGHTS_REPO}", revision=WEIGHTS_REV),
            Weight(name="bytedance/LatentSync (code)", licence="Apache-2.0", url=REPO, revision=REV),
            Weight(name=VAE_REPO, licence="MIT", url=f"https://huggingface.co/{VAE_REPO}", revision=vae_rev),
            Weight(name="openai/whisper tiny (LatentSync-1.6 whisper/tiny.pt)", licence="MIT",
                   url="https://github.com/openai/whisper", revision=WEIGHTS_REV),
        ]
        write_licences(env.models, rows)
        return rows

    def preflight(self, runtime: str) -> None:
        super().preflight(runtime)
        from ..rig.capture import check_ready

        check_ready()
        env = _env()
        if not env.python.is_file() or not (_checkpoints(env) / "latentsync_unet.pt").is_file() \
                or not (env.repo / "checkpoints").exists() or not read_licences(env.models):
            raise ArmNotBuilt(f"{ARM}: not set up; run `th fetch {ARM}`")

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        from ..rig import dub_paste
        from ..rig.capture import capture

        paste = dub_paste.mode()  # fail on a bad TH_DUB_PASTE before rendering
        env = _env()
        plate = job.run_dir / "plate.mp4"
        capture(plate, log=job.log, audio=job.audio, mouth_rest=True, seed=job.seed,
                keep=(0, 75, 150), keep_dir=job.run_dir / "frames")
        task = str(_mediapipe_task())
        env.run(["python", RUNNER, "sheet", "--model", task, "--video", plate,
                 "--frames", ",".join(map(str, SHEET_FRAMES)), "--out", job.run_dir / "alignment-sheet.png"],
                cwd=env.repo, log=job.log)
        env.run(["python", RUNNER, "infer", "--model", task, "--",
                 "--unet_config_path", "configs/unet/stage2_512.yaml",
                 "--inference_ckpt_path", "checkpoints/latentsync_unet.pt",
                 "--inference_steps", "20", "--guidance_scale", "1.5", "--enable_deepcache",
                 "--video_path", plate, "--audio_path", job.audio, "--video_out_path", job.raw,
                 "--seed", str(job.seed), "--temp_dir", job.run_dir / "ls-temp"],
                cwd=env.repo, log=job.log)
        # LatentSync's own 25 fps plate (it writes it to <repo>/temp/ whatever --temp_dir says)
        shutil.copy2(env.repo / "temp" / "video.mp4", job.run_dir / "plate25.mp4")
        pasted = ""
        if paste == "mouth":
            job.raw.replace(job.run_dir / "ls-raw.mp4")
            stats = dub_paste.composite(job.run_dir / "plate25.mp4", job.run_dir / "ls-raw.mp4", job.raw, log=job.log)
            pasted = f"; lower face only (TH_DUB_PASTE=mouth, paste {stats['seconds']}s, {stats['missed']} frames without landmarks)"
        return RawResult(video=job.raw, notes=(
            f"{NOTE}; plate = product player, mouth at rest, 1024px; LatentSync stage2_512, 20 steps, "
            f"guidance 1.5, DeepCache, 25 fps output{pasted}; no frame callback (ttffMs n/a)"))
