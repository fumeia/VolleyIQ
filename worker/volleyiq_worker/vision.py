"""Optional jersey-number reading at each detected contact.

Pipeline per contact: grab a few frames around the contact, detect people and
the ball with YOLO, take the player closest to the ball, crop the torso and
OCR digits. Reads are voted across frames and filtered to plausible jersey
numbers. Needs requirements-vision.txt; without it the worker skips this step.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict

log = logging.getLogger(__name__)

PERSON, BALL = 0, 32
OFFSETS = (-0.24, -0.08, 0.08)   # seconds around the contact (the hitter is near the ball just before)


def available() -> bool:
    try:
        import cv2  # noqa: F401
        import easyocr  # noqa: F401
        import ultralytics  # noqa: F401
        return True
    except ImportError:
        return False


class JerseyReader:
    def __init__(self, model: str = "yolov8n.pt", gpu: bool = False):
        import easyocr
        from ultralytics import YOLO

        self.det = YOLO(model)
        self.ocr = easyocr.Reader(["en"], gpu=gpu, verbose=False)

    def read(self, video_path: str, times: list[float], roster: set[int], progress=None) -> list[tuple[int | None, float]]:
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV cannot open {video_path}")
        results = []
        try:
            for i, t in enumerate(times):
                votes: dict[int, float] = defaultdict(float)
                for dt in OFFSETS:
                    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t + dt) * 1000)
                    ok, frame = cap.read()
                    if not ok:
                        continue
                    for number, conf in self._numbers_near_ball(frame):
                        # Roster numbers get a boost; others are kept so we can recognise opponents.
                        votes[number] += conf * (1.3 if number in roster else 1.0)
                if votes:
                    number, score = max(votes.items(), key=lambda kv: kv[1])
                    results.append((number, min(1.0, score / len(OFFSETS))))
                else:
                    results.append((None, 0.0))
                if progress and i % 10 == 0:
                    progress(i / max(1, len(times)))
        finally:
            cap.release()
        return results

    def _numbers_near_ball(self, frame):
        res = self.det(frame, classes=[PERSON, BALL], verbose=False)[0]
        boxes = res.boxes
        if boxes is None or len(boxes) == 0:
            return []
        xyxy = boxes.xyxy.cpu().numpy()
        cls = boxes.cls.cpu().numpy().astype(int)
        people = [b for b, c in zip(xyxy, cls) if c == PERSON]
        balls = [b for b, c in zip(xyxy, cls) if c == BALL]
        if not people:
            return []
        if balls:
            bx, by = (balls[0][0] + balls[0][2]) / 2, (balls[0][1] + balls[0][3]) / 2

            def dist(b):
                cx = min(max(bx, b[0]), b[2])
                cy = min(max(by, b[1]), b[3])
                return ((bx - cx) ** 2 + (by - cy) ** 2) ** 0.5

            candidates = sorted(people, key=dist)[:2]
        else:
            # No ball found: fall back to the largest (closest-to-camera) players.
            candidates = sorted(people, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)[:2]

        out = []
        for weight, box in zip((1.0, 0.5), candidates):
            x1, y1, x2, y2 = box
            h = y2 - y1
            crop = frame[int(y1 + 0.12 * h): int(y1 + 0.6 * h), int(x1): int(x2)]
            if crop.size == 0 or crop.shape[0] < 16 or crop.shape[1] < 10:
                continue
            crop = _upscale(crop)
            for _, text, conf in self.ocr.readtext(crop, allowlist="0123456789", detail=1):
                if re.fullmatch(r"\d{1,2}", text or "") and 0 < int(text) <= 99:
                    out.append((int(text), float(conf) * weight))
        return out


def _upscale(img, min_h: int = 96):
    import cv2

    h = img.shape[0]
    if h >= min_h:
        return img
    f = min_h / h
    return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
