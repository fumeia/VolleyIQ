"""VolleyIQ analysis worker: polls the API for jobs and posts suggested events.

Env:
  API_URL        base URL of the VolleyIQ server (default http://app:3000)
  WORKER_TOKEN   shared secret, same value as on the server
  VIDEOS_DIR     where uploaded videos live (shared volume), default /data/videos
  CACHE_DIR      where YouTube downloads are cached, default /data/cache
  YTDLP_COOKIES  optional cookies.txt for yt-dlp (YouTube often blocks datacenter IPs)
  SENSITIVITY    contact detection sensitivity, default 1.0 (higher = more contacts)
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

from . import audio, rallies, vision

log = logging.getLogger("volleyiq.worker")

API = os.environ.get("API_URL", "http://app:3000").rstrip("/")
TOKEN = os.environ.get("WORKER_TOKEN", "")
VIDEOS = Path(os.environ.get("VIDEOS_DIR", "/data/videos"))
CACHE = Path(os.environ.get("CACHE_DIR", "/data/cache"))
SENSITIVITY = float(os.environ.get("SENSITIVITY", "1.0"))

session = requests.Session()
session.headers["Authorization"] = f"Bearer {TOKEN}"


def progress(job_id: int, frac: float, message: str) -> None:
    log.info("job %s: %.0f%% %s", job_id, frac * 100, message)
    try:
        session.post(f"{API}/api/worker/jobs/{job_id}/progress", json={"progress": frac, "message": message}, timeout=10)
    except requests.RequestException:
        pass


def fetch_youtube(video_id: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"yt-{video_id}.mp4"
    if out.exists():
        return out
    cmd = [
        "yt-dlp", "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b",
        "--merge-output-format", "mp4", "-o", str(out), f"https://www.youtube.com/watch?v={video_id}",
    ]
    if os.environ.get("YTDLP_COOKIES"):
        cmd[1:1] = ["--cookies", os.environ["YTDLP_COOKIES"]]
    subprocess.run(cmd, check=True)
    return out


def process(claim: dict) -> list[dict]:
    job, match = claim["job"], claim["match"]
    job_id = job["id"]
    opts = job.get("options") or {}
    roster = {p["number"] for p in claim["players"] if p.get("number") is not None}

    if match["video_type"] == "youtube":
        progress(job_id, 0.02, "Downloading video from YouTube")
        path = fetch_youtube(match["video_ref"])
    else:
        path = VIDEOS / Path(claim["video_path"]).name
        if not path.exists():
            raise FileNotFoundError(f"Uploaded video not found: {path}")

    progress(job_id, 0.15, "Listening for ball contacts and whistles")
    _, contacts, whistles = audio.analyse_file(str(path), SENSITIVITY)
    rally_list = rallies.segment_rallies(contacts, whistles)
    for r in rally_list:
        rallies.label_rally(r)
    touches = [t for r in rally_list for t in r.touches]
    progress(job_id, 0.4, f"{len(rally_list)} rallies, {len(touches)} contacts found")

    if opts.get("jersey_ocr", True) and touches:
        if vision.available():
            progress(job_id, 0.45, "Reading jersey numbers")
            reader = vision.JerseyReader()
            reads = reader.read(str(path), [t.t for t in touches], roster,
                                progress=lambda f: progress(job_id, 0.45 + 0.5 * f, "Reading jersey numbers"))
            for touch, (number, conf) in zip(touches, reads):
                touch.jersey, touch.jersey_conf = number, conf
            for r in rally_list:
                rallies.assign_teams(r, roster)
        else:
            progress(job_id, 0.45, "Jersey OCR not installed, skipping (see README)")

    events = rallies.to_events(rally_list)
    # Unknown numbers (opponents we could not place, misreads) stay without a jersey.
    for e in events:
        if e["jersey"] is not None and roster and e["jersey"] not in roster:
            e["jersey"] = None
    return events


def run_once() -> bool:
    r = session.post(f"{API}/api/worker/claim", json={}, timeout=30)
    if r.status_code == 204:
        return False
    r.raise_for_status()
    claim = r.json()
    job_id = claim["job"]["id"]
    try:
        events = process(claim)
        session.post(f"{API}/api/worker/jobs/{job_id}/finish",
                     json={"status": "done", "events": events, "message": f"{len(events)} touches suggested"}, timeout=60)
    except Exception as exc:  # report every failure back to the UI
        log.exception("job %s failed", job_id)
        session.post(f"{API}/api/worker/jobs/{job_id}/finish",
                     json={"status": "failed", "message": f"{type(exc).__name__}: {exc}"[:500]}, timeout=30)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not TOKEN:
        sys.exit("WORKER_TOKEN is not set")
    log.info("worker started, API=%s, jersey OCR %s", API, "available" if vision.available() else "not installed")
    while True:
        try:
            if not run_once():
                time.sleep(5)
        except requests.RequestException as exc:
            log.warning("API not reachable: %s", exc)
            time.sleep(10)


if __name__ == "__main__":
    main()
