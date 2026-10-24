"""Edit-cut detection for videos that were trimmed between rallies.

With a fixed camera a cut looks like every player jumping position at once:
a spike in the mean frame-to-frame difference far above the local level of
normal motion. Cut videos have no pauses or whistles left, so these cuts are
the only reliable rally boundaries.
"""
from __future__ import annotations

import subprocess

import numpy as np
from scipy.ndimage import median_filter

W, H = 160, 90


FPS = 25.0  # resampled to a constant rate so frame index maps exactly to time (phones record VFR)


def frame_diffs(path: str) -> tuple[np.ndarray, float]:
    """Mean absolute difference between consecutive small grayscale frames, plus the frame rate."""
    proc = subprocess.Popen(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
         "-vf", f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE,
    )
    diffs, prev = [], None
    size = W * H
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).astype(np.float32)
        if prev is not None:
            diffs.append(float(np.abs(frame - prev).mean()))
        prev = frame
    proc.wait()
    return np.asarray(diffs, dtype=np.float32), FPS


def detect_cuts(diffs: np.ndarray, fps: float, ratio: float = 6.0, min_diff: float = 6.0) -> list[float]:
    """Times (s) where the picture jumps: diff far above the local median motion."""
    if len(diffs) < 3:
        return []
    med = median_filter(diffs, size=31, mode="reflect")
    score = diffs / (med + 0.3)
    cuts = []
    for i in np.where((score > ratio) & (diffs > min_diff))[0]:
        t = (i + 1) / fps
        if not cuts or t - cuts[-1] > 1.0:
            cuts.append(round(t, 2))
    return cuts
