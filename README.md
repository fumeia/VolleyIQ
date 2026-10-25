# VolleyIQ

Volleyball match tagging and stats, built for the phone: an **Android app**
for tagging from video or live courtside with **automatic first-pass
detection** on the phone, plus a small self-hosted **website** that stores the
tags and shows stats, heatmaps and court plots and shares reports.

```
 Android app (does the heavy work)                     Your server (tiny: ~80 MB RAM)
 ┌──────────────────────────────────────────────┐      ┌─────────────────────────────┐
 │ videos stay on the phone                      │      │ Node + SQLite               │
 │ import: WeTransfer, Drive, Dropbox, YouTube…  │ HTTPS│ tags, rosters, matches      │
 │ tag pad, review, stats (same UI as website)   │─────▶│ website: stats, heatmaps,   │
 │ auto-detection in the background:             │      │ court plots, share links    │
 │  sound → contacts, picture → cuts, rallies,   │      └─────────────────────────────┘
 │  jersey OCR + court side (on-device ML)       │
 └──────────────────────────────────────────────┘
```

## Features

| Area | What you get |
| --- | --- |
| Tag pad | **Tap the jersey, then the action** (one row per skill: serve, pass, set, attack, block, defence, with the outcomes side by side), then tap **where the ball was played from and where it went** on the full court. The likely next actions come first, a **Serve · #7** button starts the serve by the player in position 1, and **We won / They won** turns the last tag into the kill, ace or error (or records the opponent's). The video pauses while you tag. When a set is over, one tap starts the next. |
| Line-up | Starting six per set, libero, who serves first, substitutions at a video time. The app follows the rotation (side-outs, libero for the middles in the back row) and lists the players on court first. |
| Video | −10/−2/+2/+10 s, speeds 0.5–2×, the current time shown on the video. Portrait (video on top) or landscape (side by side). |
| Sources | App: a video on the phone, or **import a link**: WeTransfer, Google Drive, Dropbox, YouTube, Vimeo and the ~1800 sites yt-dlp supports, or any direct video link. Website: YouTube, a local file, or a direct link. |
| Auto-detection | Runs on the phone as a background job with a notification. Finds ball contacts from the sound, fills holes in a rally's rhythm (quiet far-side touches), finds edit cuts, groups touches into rallies, reads **jersey numbers**, finds the ball near the players, and with a **calibrated court** (any 4+ court points, one side switch per set) labels possessions by court side and drops the opponent's touches. Progress is saved, so app updates and reboots resume it. |
| Review | **Rally by rally**: the rally plays, its touches show as chips, and tapping a chip walks through player → action → court spots → next touch. **We won / They won** saves the rally and records how the point ended; **Not a rally** removes noise. Touches heard twice or already saved are folded automatically; touches can be added at the video time, rallies joined or split, and the last rally undone. A touch-by-touch view remains. |
| Charts | Score progression per set, attack efficiency by player and volume vs efficiency, reception quality, serve outcomes, side-out and break-point % per rotation, how each side scored, kill % by zone; per match over a season. Real axes, legends, tooltips and a table view for each; focus on one player. |
| Stats | Attack (K, E, BA, TA, K%, efficiency), serve, pass, digs, free balls, blocks, setting, points, +/−, per player and per role; court maps (where the ball went, where it was played from, paths, heatmaps) for every action; filters by set, player and skill in the event list. |
| Reports | Per match or per season, leaderboards, CSV export (both court spots in meters), and a print-ready **PDF report** (headline numbers, key findings, every chart, player table). |
| Match sheet | Optional: photograph the official Swiss Volley / FIVB sheet on the New match screen and a vision model reads the teams, rosters and set scores, so you can create the opponent's team and pre-fill the match instead of typing. Needs an AI backend configured on the server — a LiteLLM / OpenAI-compatible gateway (e.g. a university proxy) or `ANTHROPIC_API_KEY`; hidden otherwise. |
| Effort tracking | The Dashboard shows active analysis time per match, seconds per touch, and how many auto-detected touches were right, corrected or removed — to measure accuracy and the time per match. |
| Share images | **Report** tab per match and per season: chat-ready 1080×1350 images (match summary, score flow, how points were won/lost, attack/serve/reception maps, blocks & digs, rotations, box score, one card per player, season trends and leaderboard). Share them straight to WhatsApp & co., or send teammates a read-only link (`/s/…` for a match, `/s/t/…` for the season) that shows the same images plus the charts. |
| Offline | Tags are queued on the phone without a connection, and analysis results upload when it is back online. |

## Install the Android app

GitHub Actions builds the APK on every push. On your phone:

1. Open **https://github.com/fumeia/VolleyIQ/releases** and choose **VolleyIQ Android (latest build)**.
2. Tap **VolleyIQ.apk**, open it, and allow installing apps from your browser if Android asks.
3. In the app, enter your server address (e.g. `https://volleyiq.mydomain.com`) and your password.

Updates install over the old version, because every build is signed with the
same key (`web/android/keystore/sideload.jks`, committed for personal
sideloading). Before publishing the app anywhere, switch to a private key by
setting the `ANDROID_KEYSTORE_*` variables (see `web/android/app/build.gradle`).

## Run the server (Hetzner or any Docker host)

The server only stores tags and serves the website. It never receives videos
and does no analysis.

```bash
git clone https://github.com/fumeia/VolleyIQ.git volleyiq && cd volleyiq
cp .env.example .env      # set APP_PASSWORD and SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

It listens on `127.0.0.1:3080`, with a memory limit of 192 MB. Point your
existing reverse proxy at it. For nginx:

```nginx
server {
    server_name volleyiq.mydomain.com;
    listen 443 ssl;   # plus your usual certificate lines
    location / { proxy_pass http://127.0.0.1:3080; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

For Caddy: `volleyiq.mydomain.com { reverse_proxy 127.0.0.1:3080 }`.

Data lives in `./data/volleyiq.db`, a single SQLite file, so back that up.

On a server whose web server is Caddy, `deploy/install.sh` does all of the above in one go, and is safe to re-run for updates:
`sudo bash install.sh volleyiq.yourdomain.com`. It shows a plan and asks before changing anything.
It checks the Caddy config before touching it, backs up the Caddyfile and the database, and only
touches `/opt/volleyiq`, its own Docker project, and a marked block in the Caddyfile.
`sudo bash install.sh --uninstall volleyiq.yourdomain.com` removes everything again (the database is saved to `/root` first).

To see what an existing server already runs (read-only, prints a report):
`curl -fsSL https://raw.githubusercontent.com/fumeia/VolleyIQ/main/deploy/diagnose.sh -o diagnose.sh && sudo bash diagnose.sh`

## How auto-detection works

1. **Sound**: indoor ball contacts are short broadband "thuds", spikes in spectral flux. Referee whistles are long tones at 2–4.5 kHz.
2. **Picture**: in edited videos a cut makes every player jump at once, a spike in frame-to-frame difference. Cuts and whistles bound the rallies. The audio splice at a cut is ignored.
3. **Rally model**: serve, then up to three touches per side, alternating sides.
4. **Gap fill**: far-side touches are often too quiet to hear. Where a rally has a hole longer than the match's own touch rhythm, a touch is added: at a quiet sound in that spot (`quiet`), or as a guess (`gap`). Review marks them, and they have their own remove button.
5. **Vision (optional)**:
   - Around each contact, an on-device detector (MediaPipe EfficientDet-Lite0) finds the players and the ball. When the full frame shows no ball, it searches again in zoomed tiles around the players, so a ball across the court is found too.
   - The confidence mostly comes from the picture: the ball right at a player means a likely touch; the ball seen far from everyone (claps, a bounce in the corner) means likely noise. Quiet sounds with the ball elsewhere are dropped, and so are the server's bounces before the serve (with a calibration).
   - ML Kit reads the jersey number of the player nearest the ball.
   - With a **court calibration** (tap the 4 corners once per video), that player's feet are placed on the court, which tells our touches from theirs. The next touch's position gives the landing spot of passes and attacks.

Expect to correct things in Review: it's a big head start, not a referee.
- Audio works best on a camera recording with the gym sound, and poorly with music over the video.
- Jersey OCR needs readable numbers (720p or higher, camera behind a baseline).
- Small balls in low-resolution video often go undetected; then use "Ours / Theirs" in Review.

The Python package in `worker/` is the reference implementation the app's
Kotlin code was ported from, and doubles as a desktop CLI:
`python -m volleyiq_worker.cli match.mp4` (`--post SERVER --match ID` to send suggestions).

## Develop

```bash
cd server && npm install && npm run dev        # API on :3000 (no APP_PASSWORD = no login)
cd web && npm install && npm run dev           # UI on :5173, proxies /api to :3000
cd web && npm run build && npx cap sync android   # then build the APK in Android Studio or with ./gradlew
```

Tests:
- `cd server && npm test`
- `cd web && npm test`
- `cd worker && python -m pytest tests`
- Android unit tests (analysis core, link parsing) run in CI with `./gradlew testReleaseUnitTest`.
