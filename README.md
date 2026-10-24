# VolleyIQ

Self-hosted volleyball match tagging and stats, built **phone-first**: tag from a
YouTube link, a video on your phone, or live courtside, all without a keyboard.
It has per-player and per-role stats, zone heatmaps, leaderboards, CSV export,
and share links. An optional **auto-detection pass** suggests touches (and jersey
numbers) from the video, so the manual pass becomes a quick review.

## What it does

| Area | Details |
| --- | --- |
| Teams & roster | Players with jersey number and role (OH, OPP, MB, S, L, DS) |
| Tag from video | YouTube, a file picked on the phone (plays locally, no upload), or an uploaded file |
| Live match | The same tag pad without video, with a running score per set |
| Tag pad | **Tap jersey → tap action → (zone)**. The video pauses on the first tap and resumes after the tag. A configurable reaction-time lead shifts the timestamp back. Undo toast. |
| Video control | Tap the video to play/pause, double-tap left/right to skip ∓5 s, plus −10/−2/+2/+10 buttons and 0.5–2× speed |
| Actions | Same set as VolleyTag: errors (attack/serve/dig/block), attack, serve, dig, block touch, kill, ace, block point, set, assist, assist error, receive 0–3, plus opponent error/point for the score |
| Stats | Attack (K, E, TA, K%, efficiency), serve (aces, errors, in%), pass (avg, perfect%, errors), dig, block, setting, points, +/−; per player and per role |
| Heatmaps | Zones 1–6 for kills, all attacks, attack errors, serves, aces; filter by player |
| Reports | Per match or across all matches of a team, plus a leaderboard |
| Sharing | Read-only link per match (`/s/<token>`), revocable |
| Offline | Tags are queued on the phone when the gym Wi-Fi drops and sync later |
| Desktop | VolleyTag-style hotkeys (Q W E R / A S D F / Z X V / T Y / 0–3), Space, ←/→ |

### Auto-detection (first pass) → review (second pass)

1. In a match, open **Auto ✨** and run it. This needs a YouTube link or an uploaded video.
2. The worker:
   - extracts the audio and finds **ball contacts** (short broadband impulses) and **whistles** (tonal 2–4.5 kHz);
   - groups contacts into **rallies** and labels them with the volleyball touch pattern: serve, then up to 3 touches per side (receive/dig → set → attack), alternating sides;
   - optionally (`VISION=1`) grabs frames around each contact, uses YOLO to find the player nearest the ball, and reads the **jersey number** with OCR. Numbers on your roster mark a possession as "ours", and the possessions in between are dropped as the opponent's.
3. Everything lands in **Review** as a suggestion. Each one plays a short clip around the contact. Then:
   - tap the right jersey to fix the player and confirm in one go;
   - tap an action chip to change the action;
   - or tap **Not a touch** to delete it.

   You can add missing tags at any time from the Tag tab.

Be realistic about accuracy. Audio contact detection works well on clean gym
recordings and badly with music or loud crowds. Jersey OCR depends heavily on
resolution and camera angle: a 720p+ video from behind the baseline works best.
Expect to fix things in review. It's still much faster than tagging from scratch.
Tune with `SENSITIVITY`.

## Deploy on Hetzner (Docker)

Prerequisites: a Hetzner Cloud server (CX22 is enough without OCR, CX32 or better
with OCR) running Ubuntu with Docker installed, and a DNS A record for
`volleyiq.mydomain.com` pointing to the server.

```bash
git clone <this repo> volleyiq && cd volleyiq
cp .env.example .env
# edit .env: DOMAIN, APP_PASSWORD, and random SESSION_SECRET / WORKER_TOKEN (openssl rand -hex 32)
# set VISION=1 if you want jersey-number OCR
docker compose up -d --build
```

Caddy gets the HTTPS certificate automatically. Then open
`https://volleyiq.mydomain.com` on your phone and use **Add to Home screen**: it
runs full-screen like an app and keeps the screen awake while tagging.

Data (SQLite database, uploaded videos, YouTube cache, model weights) lives in
`./data`, so back that folder up.

**YouTube downloads from a datacenter IP:** YouTube sometimes blocks servers. If
analysis fails with a yt-dlp error, export your browser's YouTube cookies to
`data/cookies.txt` and set `YTDLP_COOKIES=/data/cookies.txt`. Or download the
video and upload it from the Auto ✨ tab.

## Develop

```bash
# API (http://localhost:3000)
cd server && npm install && npm run dev
# Web (http://localhost:5173, proxies /api to :3000; open on your phone via your LAN IP)
cd web && npm install && npm run dev
# Worker
cd worker && pip install -r requirements.txt && API_URL=http://localhost:3000 WORKER_TOKEN=dev VIDEOS_DIR=../data/videos python -m volleyiq_worker.main
```

Start the server with `WORKER_TOKEN=dev` so the worker can authenticate. Without
`APP_PASSWORD` the app has no login, which is fine locally but never acceptable
on a public server.

Tests: `cd server && npm test`, `cd web && npm test`, `cd worker && python -m pytest tests`.

## Architecture

```
phone ──HTTPS──▶ Caddy ──▶ app (Node/Fastify + SQLite, serves the React PWA and /media range streaming)
                               ▲
                     worker ───┘ polls /api/worker/claim, posts suggestions
                     (Python: ffmpeg + numpy/scipy audio, optional YOLO + EasyOCR)
```

- `server/`: REST API, auth (single coach password, cookie session), uploads, job queue
- `web/`: React + TypeScript, mobile-first UI; stats are computed client-side (`web/src/lib/stats.ts`)
- `worker/`: analysis pipeline (`audio.py` → `rallies.py` → optional `vision.py`)
