"""Audio-based detection of ball contacts and referee whistles.

Ball contacts in an indoor gym are short, broadband "thuds" that show up as
sharp spikes of spectral flux. Whistles are sustained, narrow-band tones
around 2-4.5 kHz. Both are cheap to find on a CPU, which makes audio the
backbone of the first automatic pass; vision (jersey numbers) is layered on top.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import find_peaks

SR = 16000
HOP = 160          # 10 ms
NFFT = 512         # 32 ms window
FPS = SR / HOP     # feature frames per second


@dataclass
class AudioFeatures:
    flux: np.ndarray        # onset strength per frame (1-6 kHz spectral flux)
    tonality: np.ndarray    # peak-to-mean ratio inside the whistle band
    band_db: np.ndarray     # whistle-band energy in dB
    duration: float


def iter_audio(path: str, chunk_seconds: float = 60.0):
    """Streams mono 16 kHz float32 audio from any file ffmpeg can read."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    chunk_bytes = int(chunk_seconds * SR) * 4
    try:
        while True:
            buf = proc.stdout.read(chunk_bytes)
            if not buf:
                break
            yield np.frombuffer(buf[: len(buf) - len(buf) % 4], dtype=np.float32)
    finally:
        proc.stdout.close()
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed to decode audio from {path}")


def features_from_chunks(chunks) -> AudioFeatures:
    window = np.hanning(NFFT).astype(np.float32)
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    onset_band = (freqs >= 1000) & (freqs <= 6000)
    whistle_band = (freqs >= 2000) & (freqs <= 4500)

    flux_parts, tone_parts, band_parts = [], [], []
    carry = np.zeros(0, dtype=np.float32)
    prev_mag = None
    total = 0
    for chunk in chunks:
        total += len(chunk)
        x = np.concatenate([carry, chunk])
        n_frames = 1 + (len(x) - NFFT) // HOP if len(x) >= NFFT else 0
        if n_frames <= 0:
            carry = x
            continue
        idx = np.arange(NFFT)[None, :] + HOP * np.arange(n_frames)[:, None]
        mag = np.abs(np.fft.rfft(x[idx] * window, axis=1)).astype(np.float32)
        carry = x[n_frames * HOP:]

        logmag = np.log1p(100 * mag[:, onset_band])
        first = logmag[:1] if prev_mag is None else prev_mag
        diff = np.diff(np.vstack([first, logmag]), axis=0)
        flux_parts.append(np.maximum(diff, 0).sum(axis=1))
        prev_mag = logmag[-1:]

        wb = mag[:, whistle_band]
        tone_parts.append(wb.max(axis=1) / (wb.mean(axis=1) + 1e-9))
        band_parts.append(10 * np.log10((wb ** 2).mean(axis=1) + 1e-12))

    if not flux_parts:
        empty = np.zeros(0, dtype=np.float32)
        return AudioFeatures(empty, empty, empty, total / SR)
    return AudioFeatures(
        flux=np.concatenate(flux_parts),
        tonality=np.concatenate(tone_parts),
        band_db=np.concatenate(band_parts),
        duration=total / SR,
    )


def detect_contacts(feat: AudioFeatures, sensitivity: float = 1.0, min_gap: float = 0.35,
                    whistles: list[tuple[float, float]] | None = None) -> list[tuple[float, float]]:
    """Returns (time_seconds, strength 0..1) for each likely ball contact.

    Onsets at the start/end of a whistle are spectral-flux spikes too, so they are excluded.
    """
    flux = feat.flux
    if len(flux) < 10:
        return []
    # Adaptive threshold: local median + k * local MAD over a 3 s window.
    win = int(3 * FPS) | 1
    med = median_filter(flux, size=win, mode="reflect")
    mad = median_filter(np.abs(flux - med), size=win, mode="reflect")
    mad = np.maximum(mad, 0.02 * med + 1e-6)  # flat stretches (digital silence) must not explode z
    z = (flux - med) / mad
    thr = 8.0 / sensitivity
    peaks, props = find_peaks(z, height=thr, distance=max(1, int(min_gap * FPS)))
    out = []
    for p, h in zip(peaks, props["peak_heights"]):
        t = (p + NFFT / 2 / HOP) / FPS  # frame index -> window centre
        if whistles and any(a - 0.15 <= t <= b + 0.15 for a, b in whistles):
            continue
        # Impulses are short: reject onsets whose energy stays high (music, crowd noise, speech bursts).
        tail = flux[p + 3 : p + 12]
        if len(tail) and tail.mean() > 0.6 * flux[p]:
            continue
        strength = float(1 - np.exp(-(h - thr) / (2 * thr)))
        out.append((t, max(0.05, min(1.0, strength))))
    return out


def detect_whistles(feat: AudioFeatures, min_len: float = 0.25) -> list[tuple[float, float]]:
    """Returns (start, end) of sustained tonal sounds in the whistle band."""
    if len(feat.tonality) == 0:
        return []
    loud = feat.band_db > np.percentile(feat.band_db, 60) + 6
    mask = (feat.tonality > 12) & loud
    # Close small gaps (vibrato / frame jitter), then keep long runs.
    mask = median_filter(mask.astype(np.uint8), size=5) > 0
    runs = []
    start = None
    for i, on in enumerate(np.append(mask, False)):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if (i - start) / FPS >= min_len:
                runs.append((start / FPS, i / FPS))
            start = None
    return runs


def analyse_file(path: str, sensitivity: float = 1.0):
    feat = features_from_chunks(iter_audio(path))
    whistles = detect_whistles(feat)
    return feat, detect_contacts(feat, sensitivity, whistles=whistles), whistles
