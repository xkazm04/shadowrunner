"""Arm registry: ARM_IDS -> classes. Each arm lives in its own module; a work package replaces only
its module, never this file."""

from __future__ import annotations

from ..schema import ARM_IDS
from .a2f import A2FArm
from .base import Arm, ArmEnv, ArmNotBuilt, Job, RawResult
from .baseline import BaselineArm
from .dub import DubArm
from .flashhead import FlashHeadArm
from .infinitetalk import InfiniteTalkArm
from .noop import NoopArm
from .stableavatar import StableAvatarArm

REGISTRY: dict[str, type[Arm]] = {
    cls.id: cls
    for cls in (NoopArm, BaselineArm, InfiniteTalkArm, StableAvatarArm, FlashHeadArm, DubArm, A2FArm)
}

assert tuple(REGISTRY) == ARM_IDS, "registry order must match schema.ARM_IDS"


def get_arm(arm_id: str) -> Arm:
    try:
        return REGISTRY[arm_id]()
    except KeyError:
        raise SystemExit(f"th: unknown arm '{arm_id}' (known: {', '.join(ARM_IDS)})") from None


__all__ = ["ARM_IDS", "REGISTRY", "Arm", "ArmEnv", "ArmNotBuilt", "Job", "RawResult", "get_arm"]
