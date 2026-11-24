"""Standalone (run it with any CUDA venv's python; not imported by th). Does a CUDA allocation count against host commit on this WDDM GPU? The process puts itself in a
Job Object with a 40 GB job memory limit, then reads its own PrivateUsage and the job's
PeakJobMemoryUsed before and after allocating 4 GB of VRAM (and after freeing it)."""
import ctypes
import ctypes.wintypes as wt
import sys

k32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi
k32.GetCurrentProcess.restype = ctypes.c_void_p
k32.CreateJobObjectW.restype = ctypes.c_void_p


class IO(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]


class BASIC(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wt.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wt.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wt.DWORD), ("SchedulingClass", wt.DWORD)]


class EXT(ctypes.Structure):
    _fields_ = [("Basic", BASIC), ("Io", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t)]


class PMC(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
        (n, ctypes.c_size_t) for n in (
            "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
            "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage",
            "PeakPagefileUsage", "PrivateUsage")]


JOB_EXT = 9
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200
job = k32.CreateJobObjectW(None, None)
lim = EXT()
lim.Basic.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY
lim.JobMemoryLimit = 40 * 2**30
k32.SetInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
k32.QueryInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, wt.DWORD,
                                          ctypes.c_void_p]
k32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
assert k32.SetInformationJobObject(job, JOB_EXT, ctypes.byref(lim), ctypes.sizeof(lim))
assert k32.AssignProcessToJobObject(job, k32.GetCurrentProcess())
psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]


def read(tag):
    c = PMC()
    c.cb = ctypes.sizeof(PMC)
    psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    e = EXT()
    k32.QueryInformationJobObject(job, JOB_EXT, ctypes.byref(e), ctypes.sizeof(e), None)
    print(f"{tag:34s} process commit {c.PrivateUsage / 2**30:6.2f} GB   "
          f"job peak {e.PeakJobMemoryUsed / 2**30:6.2f} GB", flush=True)
    return c.PrivateUsage


import torch  # noqa: E402

torch.cuda.init()
torch.zeros(1, device="cuda")
base = read("CUDA context")
x = torch.empty(4 * 2**30, dtype=torch.uint8, device="cuda")   # 4 GB, untouched
a = read("4 GB allocated (untouched)")
x.fill_(1)
torch.cuda.synchronize()
b = read("4 GB written")
y = torch.empty(4 * 2**30, dtype=torch.uint8, device="cuda")
y.fill_(2)
torch.cuda.synchronize()
c = read("8 GB written")
del x, y
torch.cuda.empty_cache()
d = read("freed + empty_cache")
print(f"delta per 4 GB of VRAM: {(b - base) / 2**30:.2f} GB of host commit; "
      f"after 8 GB {(c - base) / 2**30:.2f}; after free {(d - base) / 2**30:.2f}")
sys.exit(0)
