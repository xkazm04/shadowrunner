"""LivePortrait over FlashHead: re-render each FlashHead frame with a 3D head rotation added.

Per frame (all on the GPU, batched):
- the FlashHead frame is cropped with ONE fixed crop (from the source's MediaPipe landmarks, the
  LivePortrait crop rule: square, 2.3x the landmark extent, shifted 12.5 % down, rotated upright),
  sampled at 512 and area-downscaled to 256 as upstream does;
- LivePortrait's motion extractor M reads its rotation (pitch, yaw, roll), expression, scale and
  translation;
- driving keypoints = scale_d * (kp_c @ R(pitch_d + dp, yaw_d + dy, roll_d + dr) + exp_d) + t_d, with
  kp_c the canonical keypoints of the source; then LivePortrait's stitching (its shoulder-alignment
  MLP) and warp + SPADE decode (256 -> 512);
- paste-back: the 512 output is warped back into the frame through the crop transform and blended with
  upstream's feathered mask template; outside the mask the FlashHead frame is kept as is.

Two sources (`source=`):
- "bust" (the brief): appearance features and canonical keypoints from the Iris bust, once. The mouth
  interior and teeth are then the renderer's guess from the bust's closed mouth, driven by the
  expression coefficients.
- "frame": appearance features and keypoints from each FlashHead frame itself, so the rotation is
  the only change (with a zero track it reconstructs the frame). Costs one F pass per frame.
No eye or lip retargeting is used: the expression comes straight from the FlashHead frame.

`detail` (experiment, 0 = off): adds the FlashHead frame's high frequencies, moved by a flow interpolated
from the keypoints' xy motion, inside the face. It sharpens, but ghosts the eyeliner and the mic boom at
10 degrees of yaw, so it is not used for the review clips.
"""

from __future__ import annotations

import importlib
import sys
import types

import numpy as np

from .lp_setup import repo_dir, weights_dir

CROP_SCALE = 2.3
CROP_VY = -0.125
# MediaPipe Face Landmarker indices: eye corners and mouth corners (the LivePortrait crop's two
# axis points are the eye centre and the mouth centre)
L_EYE = (33, 133)
R_EYE = (362, 263)
MOUTH = (61, 291)


def _lp_modules():
    """LivePortrait's src/ as the package `lpsrc` (it has no __init__.py; avoids a clash on `src`)."""
    if "lpsrc" not in sys.modules:
        pkg = types.ModuleType("lpsrc")
        pkg.__path__ = [str(repo_dir() / "src")]
        sys.modules["lpsrc"] = pkg
    wrapper = importlib.import_module("lpsrc.live_portrait_wrapper")
    cfg = importlib.import_module("lpsrc.config.inference_config")
    cam = importlib.import_module("lpsrc.utils.camera")
    return wrapper, cfg, cam


def crop_transform(pts: np.ndarray, dsize: int = 512, scale: float = CROP_SCALE,
                   vy: float = CROP_VY) -> np.ndarray:
    """3x3 original -> crop (dsize) similarity from (478, 2) landmarks, as upstream's
    parse_rect_from_landmark + _estimate_similar_transform_from_pts (pixel centres at integers)."""
    eye = (pts[list(L_EYE)].mean(0) + pts[list(R_EYE)].mean(0)) / 2
    mouth = pts[list(MOUTH)].mean(0)
    uy = mouth - eye
    uy = uy / max(np.linalg.norm(uy), 1e-3)
    ux = np.array([uy[1], -uy[0]])
    rot = np.stack([ux, uy])
    c0 = pts.mean(0)
    r = (pts - c0) @ rot.T
    lo, hi = r.min(0), r.max(0)
    c1 = (lo + hi) / 2
    size = float((hi - lo).max()) * scale
    center = c0 + ux * c1[0] + uy * c1[1] + uy * (vy * size)
    s = dsize / size
    # crop = s * rot @ (x - center) + dsize/2
    m = np.eye(3)
    m[:2, :2] = s * rot
    m[:2, 2] = dsize / 2 - s * rot @ center
    return m


def _grid(m_out_to_in: np.ndarray, out_hw: tuple[int, int], in_hw: tuple[int, int]):
    """grid_sample grid (1, H, W, 2) sampling `in` at m @ (x, y, 1) for each `out` pixel."""
    import torch

    h, w = out_hw
    ys, xs = np.meshgrid(np.arange(h, dtype=np.float64), np.arange(w, dtype=np.float64), indexing="ij")
    p = np.stack([xs, ys, np.ones_like(xs)], -1) @ m_out_to_in.T
    gx = (p[..., 0] + 0.5) / in_hw[1] * 2 - 1
    gy = (p[..., 1] + 0.5) / in_hw[0] * 2 - 1
    return torch.from_numpy(np.stack([gx, gy], -1)[None].astype(np.float32))


class LPRenderer:
    def __init__(self, source_rgb: np.ndarray, landmarks: np.ndarray, source: str = "bust",
                 device: str = "cuda", half: bool = True, stitching: bool = True,
                 stride: int = 1, crop_scale: float = CROP_SCALE, detail: float = 0.0) -> None:
        import cv2
        import torch
        import torch.nn.functional as F

        self.torch, self.F = torch, F
        wrapper, cfgmod, cam = _lp_modules()
        self.get_rotation_matrix = cam.get_rotation_matrix
        w = weights_dir()
        cfg = cfgmod.InferenceConfig(
            checkpoint_F=str(w / "base_models/appearance_feature_extractor.pth"),
            checkpoint_M=str(w / "base_models/motion_extractor.pth"),
            checkpoint_G=str(w / "base_models/spade_generator.pth"),
            checkpoint_W=str(w / "base_models/warping_module.pth"),
            checkpoint_S=str(w / "retargeting_models/stitching_retargeting_module.pth"),
            flag_use_half_precision=half, flag_stitching=stitching)
        self.lp = wrapper.LivePortraitWrapper(cfg)
        self.device = device
        self.source = source
        self.stitch_on = stitching
        self.stride = stride  # "frame" source: appearance features from every stride-th frame, reused
        h, wd = source_rgb.shape[:2]
        self.hw = (h, wd)
        self.m_o2c = crop_transform(landmarks, scale=crop_scale)
        m_c2o = np.linalg.inv(self.m_o2c)
        self.grid_crop = _grid(m_c2o, (512, 512), (h, wd)).to(device)
        self.grid_paste = _grid(self.m_o2c, (h, wd), (512, 512)).to(device)
        mask = cv2.resize(cfg.mask_crop, (512, 512), interpolation=cv2.INTER_LINEAR)[..., :1]
        mask_t = torch.from_numpy(mask.astype(np.float32) / 255).permute(2, 0, 1)[None].to(device)
        self.mask = F.grid_sample(mask_t, self.grid_paste, mode="bilinear", padding_mode="zeros",
                                  align_corners=False)  # (1, 1, h, w)
        self.detail = detail
        self.face = self._face_mask(landmarks, (h, wd)) if detail > 0 else None
        src = torch.from_numpy(np.ascontiguousarray(source_rgb))[None].to(device)
        x = self.crop256(src)
        self.f_s = self.lp.extract_feature_3d(x)
        self.info_s = self.lp.get_kp_info(x)
        self.x_s = self.lp.transform_keypoint(self.info_s)

    # crops ------------------------------------------------------------------------------------
    def crop256(self, frames_u8):
        """(N, H, W, 3) uint8 CUDA -> (N, 3, 256, 256) float 0..1, the fixed crop."""
        F = self.F
        x = frames_u8.permute(0, 3, 1, 2).float() / 255
        c = F.grid_sample(x, self.grid_crop.expand(len(x), -1, -1, -1), mode="bilinear",
                          padding_mode="border", align_corners=False)
        return F.interpolate(c, size=(256, 256), mode="area")

    def paste(self, out512, frames_u8):
        """Generator output (N, 3, 512, 512) 0..1 into the frames -> (N, H, W, 3) uint8."""
        F = self.F
        bg = frames_u8.permute(0, 3, 1, 2).float() / 255
        warped = F.grid_sample(out512, self.grid_paste.expand(len(out512), -1, -1, -1), mode="bilinear",
                               padding_mode="zeros", align_corners=False)
        y = self.mask * warped + (1 - self.mask) * bg
        return (y.clamp(0, 1) * 255 + 0.5).to(self.torch.uint8).permute(0, 2, 3, 1).contiguous()

    # detail transfer (experiment) ----------------------------------------------------------------
    def _face_mask(self, pts: np.ndarray, hw: tuple[int, int]):
        """The face (landmark hull, brows to chin, no hair) of the source, feathered: (1, 1, h, w)."""
        import cv2

        m = np.zeros(hw, np.float32)
        cv2.fillConvexPoly(m, cv2.convexHull(pts.astype(np.int32)), 1.0)
        m = cv2.erode(m, np.ones((9, 9), np.uint8))
        m = cv2.GaussianBlur(m, (0, 0), 6)
        return self.torch.from_numpy(m)[None, None].to(self.device)

    def _flow(self, x_s, x_d):
        """Dense 2D displacement (N, h, w, 2) in frame pixels, output -> FlashHead frame, from the
        keypoints' xy motion (driving -> source), Gaussian-weighted (sigma 0.25 of the crop)."""
        torch = self.torch
        h, w = self.hw
        m_c2o = torch.as_tensor(np.linalg.inv(self.m_o2c), dtype=torch.float32, device=self.device)

        def to_frame(k):  # LivePortrait kp xy in [-1, 1] of the crop -> frame pixels
            c = (k[..., :2] + 1) / 2 * 511
            return c @ m_c2o[:2, :2].T + m_c2o[:2, 2]

        pd, ps = to_frame(x_d), to_frame(x_s)  # (N, K, 2)
        st = 4  # evaluated on a 4 px lattice, then upsampled (the field is smooth)
        ys, xs = torch.meshgrid(torch.arange(h // st, device=self.device, dtype=torch.float32) * st + (st - 1) / 2,
                                torch.arange(w // st, device=self.device, dtype=torch.float32) * st + (st - 1) / 2,
                                indexing="ij")
        u = torch.stack([xs, ys], -1).reshape(1, -1, 1, 2)  # (1, P, 1, 2)
        sig = 0.25 * 512 / float(np.sqrt(abs(np.linalg.det(self.m_o2c[:2, :2]))))
        wgt = torch.exp(-((u - pd[:, None]) ** 2).sum(-1) / (2 * sig * sig))  # (N, P, K)
        disp = (wgt[..., None] * (ps - pd)[:, None]).sum(2) / (wgt.sum(2, keepdim=True) + 1e-6)
        disp = disp.reshape(len(x_s), h // st, w // st, 2).permute(0, 3, 1, 2)
        return self.F.interpolate(disp, size=(h, w), mode="bilinear", align_corners=False).permute(0, 2, 3, 1)

    def _add_detail(self, y_u8, frames_u8, x_s, x_d):
        """Add the FlashHead frame's high frequencies (frame - Gaussian blur, sigma 1.2), moved by the
        keypoint flow, inside the moved face mask."""
        torch, F = self.torch, self.F
        h, w = self.hw
        x = frames_u8.permute(0, 3, 1, 2).float() / 255
        k = torch.exp(-torch.arange(-4, 5, device=self.device, dtype=torch.float32) ** 2 / (2 * 1.2 ** 2))
        k = k / k.sum()
        blur = F.conv2d(F.pad(x, (4, 4, 0, 0), mode="replicate"), k.view(1, 1, 1, 9).expand(3, 1, 1, 9), groups=3)
        blur = F.conv2d(F.pad(blur, (0, 0, 4, 4), mode="replicate"), k.view(1, 1, 9, 1).expand(3, 1, 9, 1), groups=3)
        hp = torch.cat([x - blur, self.face.expand(len(x), -1, -1, -1)], 1)
        disp = self._flow(x_s, x_d)
        ys, xs = torch.meshgrid(torch.arange(h, device=self.device, dtype=torch.float32),
                                torch.arange(w, device=self.device, dtype=torch.float32), indexing="ij")
        src = torch.stack([xs, ys], -1)[None] + disp
        grid = torch.stack([(src[..., 0] + 0.5) / w * 2 - 1, (src[..., 1] + 0.5) / h * 2 - 1], -1)
        moved = F.grid_sample(hp, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
        y = y_u8.permute(0, 3, 1, 2).float() / 255 + self.detail * moved[:, 3:] * moved[:, :3]
        return (y.clamp(0, 1) * 255 + 0.5).to(torch.uint8).permute(0, 2, 3, 1).contiguous()

    def kp(self, info: dict, d_ang=None, canon=None):
        """Driving keypoints from `info` with (N, 3) [yaw, pitch, roll] degrees added."""
        p, y, r = info["pitch"], info["yaw"], info["roll"]
        if d_ang is not None:
            y, p, r = y + d_ang[:, 0:1], p + d_ang[:, 1:2], r + d_ang[:, 2:3]
        rot = self.get_rotation_matrix(p, y, r)
        kc = info["kp"] if canon is None else canon.expand(len(rot), -1, -1)
        kp = kc @ rot + info["exp"]
        kp = kp * info["scale"][..., None]
        t = info["t"].clone()
        t[:, 2] = 0
        return kp + t[:, None, :]

    def render(self, frames_u8, angles: np.ndarray | None, return_info: bool = False):
        """FlashHead frames (N, H, W, 3) uint8 CUDA + (N, 3) degrees -> re-rendered frames."""
        torch = self.torch
        n = len(frames_u8)
        x = self.crop256(frames_u8)
        info = self.lp.get_kp_info(x)
        d = None if angles is None else torch.as_tensor(np.asarray(angles), dtype=torch.float32,
                                                        device=self.device)
        if self.source == "bust":
            f_s = self.f_s.expand(n, -1, -1, -1, -1)
            x_s = self.x_s.expand(n, -1, -1)
            x_d = self.kp(info, d, canon=self.info_s["kp"])
        elif self.stride <= 1:
            f_s = self.lp.extract_feature_3d(x)
            x_s = self.kp(info)
            x_d = self.kp(info, d)
        else:  # features and source keypoints of frame i - i % stride (chunk-local)
            j = torch.arange(n, device=x.device) // self.stride * self.stride
            keys = torch.unique(j)
            f_k = self.lp.extract_feature_3d(x[keys])
            f_s = f_k[torch.searchsorted(keys, j)]
            x_s = self.kp(info)[j]
            x_d = self.kp(info, d)
        if self.stitch_on:
            x_d = self.lp.stitching(x_s, x_d)
        out = self.lp.warp_decode(f_s, x_s, x_d)["out"]
        y = self.paste(out, frames_u8)
        if self.detail > 0:
            y = self._add_detail(y, frames_u8, x_s, x_d)
        if return_info:
            return y, {k: info[k][:, 0].cpu().numpy() for k in ("yaw", "pitch", "roll")}
        return y

    def pose(self, frames_u8) -> np.ndarray:
        """LivePortrait's own (N, 3) [yaw, pitch, roll] estimate on frames (same fixed crop)."""
        info = self.lp.get_kp_info(self.crop256(frames_u8))
        return np.stack([info[k][:, 0].cpu().numpy() for k in ("yaw", "pitch", "roll")], 1)
