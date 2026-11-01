# --- build the web app ---
FROM node:22-bookworm-slim AS web
LABEL org.volleyiq.build=1
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- API server + static files ---
FROM node:22-bookworm-slim AS app
LABEL org.volleyiq.build=1
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /web/dist /app/web/dist
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST=/app/web/dist PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "src/index.js"]

# --- video converter (only started when video storage is set up): the same app plus ffmpeg ---
FROM mwader/static-ffmpeg:7.1 AS ffmpeg
FROM app AS transcoder
LABEL org.volleyiq.build=1
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
CMD ["node", "src/transcoder.js"]
