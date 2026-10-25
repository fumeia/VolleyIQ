"""Desktop / laptop CLI for the same first-pass analysis the Android app runs.

This is the reference implementation the app's Kotlin code is ported from
(web/android/app/src/main/java/com/volleyiq/app/analysis). Handy for tuning on a
computer, or for posting suggestions for a match from a machine with the video.

  python -m volleyiq_worker.cli match.mp4                 # print rallies and touches
  python -m volleyiq_worker.cli match.mp4 --no-cuts       # uncut recording
  python -m volleyiq_worker.cli match.mp4 --post https://volleyiq.example.com --match 12 --password ...
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

from . import audio, rallies, video


def analyse(path: str, sensitivity: float = 1.0, cuts: bool = True):
    feat, contacts, whistles = audio.analyse_file(path, sensitivity)
    sensitive = audio.detect_contacts(feat, sensitivity * rallies.QUIET_BOOST, whistles=whistles)
    quiet = rallies.quiet_contacts(contacts, sensitive)
    cut_times = video.detect_cuts(*video.frame_diffs(path)) if cuts else []
    found = rallies.segment_rallies(contacts, whistles, cut_times)
    interval = rallies.typical_interval(found)
    for r in found:
        rallies.fill_gaps(r, quiet, interval)
        rallies.label_rally(r)
    return found, cut_times


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--sensitivity", type=float, default=1.0)
    ap.add_argument("--no-cuts", action="store_true", help="skip edit-cut detection (uncut recordings)")
    ap.add_argument("--json", action="store_true", help="print suggestions as JSON")
    ap.add_argument("--post", metavar="SERVER", help="send suggestions to this VolleyIQ server")
    ap.add_argument("--match", type=int, help="match id on the server")
    ap.add_argument("--password", help="VolleyIQ password (for --post)")
    args = ap.parse_args(argv)

    found, cut_times = analyse(args.video, args.sensitivity, not args.no_cuts)
    events = rallies.to_events(found)

    if args.json:
        json.dump(events, sys.stdout, indent=1)
        print()
    else:
        print(f"edit cuts: {', '.join(f'{c:.1f}s' for c in cut_times) or 'none'}")
        for ri, r in enumerate(found, start=1):
            touches = " ".join(f"{t.t:.1f}:{t.action}{'?' if t.kind != 'heard' else ''}" for t in r.touches)
            print(f"rally {ri:2d}  {r.start:6.1f}-{r.end:6.1f}s  {touches}")

    if args.post:
        if not args.match:
            ap.error("--post needs --match")
        s = requests.Session()
        base = args.post.rstrip("/")
        if args.password:
            s.post(f"{base}/api/login", json={"password": args.password}, timeout=20).raise_for_status()
        r = s.post(f"{base}/api/matches/{args.match}/suggestions", json={"events": events, "replace": True}, timeout=60)
        r.raise_for_status()
        print(f"posted: {r.json()['inserted']} suggestions", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
