FROM python:3.12-slim
ARG VISION=0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$VISION" = "1" ]; then pip install --no-cache-dir -r requirements-vision.txt; fi
COPY volleyiq_worker ./volleyiq_worker
# Model weights (YOLO, EasyOCR) are downloaded on first use into the cache volume.
ENV PYTHONUNBUFFERED=1 YOLO_CONFIG_DIR=/data/cache/ultralytics EASYOCR_MODULE_PATH=/data/cache/easyocr HOME=/data/cache
CMD ["python", "-m", "volleyiq_worker.main"]
