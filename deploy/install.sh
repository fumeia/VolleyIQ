#!/usr/bin/env bash
# Installs or updates VolleyIQ on a Docker host whose web server is Caddy (systemd).
#
#   sudo bash install.sh volleyiq.yourdomain.com
#
# What it does (and nothing else):
#   1. clones/updates the code in /opt/volleyiq (your .env and data/ are never touched)
#   2. on first run, asks for the login password and writes /opt/volleyiq/.env
#   3. builds and starts the container on 127.0.0.1:3080 (memory capped at 192 MB),
#      then deletes the build leftovers to save disk
#   4. adds one site block for the domain to /etc/caddy/Caddyfile (backup first,
#      validated before reload, restored if invalid) unless the domain is already there
# Running it again updates VolleyIQ to the latest version.
set -euo pipefail

DOMAIN="${1:-}"
DIR=/opt/volleyiq
REPO=https://github.com/fumeia/VolleyIQ.git
BRANCH="${BRANCH:-claude/volleyball-tagging-mobile-2dnlu1}"
CADDYFILE=/etc/caddy/Caddyfile
PORT=3080

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "usage: sudo bash install.sh volleyiq.yourdomain.com"
[ "$(id -u)" = 0 ] || die "please run with sudo"
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"
command -v git >/dev/null || die "git is not installed"

free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_mb" ] && [ "$free_mb" -lt 1500 ]; then
  die "only ${free_mb} MB free for Docker; the build needs about 1.5 GB temporarily (try: docker image prune)"
fi

say "Getting the code ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"   # tracked files only; .env and data/ stay
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  say "First install: choose the VolleyIQ login password (used on the website and in the app)"
  while true; do
    read -rsp "Password: " pw1; echo
    read -rsp "Repeat:   " pw2; echo
    [ "$pw1" = "$pw2" ] && [ ${#pw1} -ge 8 ] && break
    echo "Passwords differ or are shorter than 8 characters, try again."
  done
  umask 077
  printf 'APP_PASSWORD=%s\nSESSION_SECRET=%s\nPORT=%s\n' "$pw1" "$(openssl rand -hex 32)" "$PORT" > .env
  unset pw1 pw2
fi
mkdir -p data

say "Building and starting the container"
docker compose up -d --build
# Build stages and cache are only needed while building; free the disk again.
docker builder prune -af >/dev/null || true
docker image prune -f >/dev/null || true

for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && die "VolleyIQ did not start; see: docker compose -f $DIR/docker-compose.yml logs"
  sleep 1
done
echo "VolleyIQ is running on 127.0.0.1:$PORT"

if command -v caddy >/dev/null && [ -f "$CADDYFILE" ]; then
  if grep -qE "^[[:space:]]*${DOMAIN//./\\.}([[:space:],{]|$)" "$CADDYFILE"; then
    say "Caddy already has a block for $DOMAIN, leaving it as it is"
  else
    say "Adding $DOMAIN to Caddy"
    backup="$CADDYFILE.bak-volleyiq-$(date +%Y%m%d%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
    cat >> "$CADDYFILE" <<EOF

$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
    if caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1; then
      systemctl reload caddy
      echo "Caddy reloaded (backup: $backup)"
    else
      cp -p "$backup" "$CADDYFILE"
      die "Caddy rejected the new config; your original Caddyfile was restored"
    fi
  fi
else
  say "Caddy not found: point your reverse proxy at 127.0.0.1:$PORT for $DOMAIN"
fi

say "DNS check"
if getent hosts "$DOMAIN" >/dev/null; then
  getent hosts "$DOMAIN"
  echo "Open https://$DOMAIN (the first visit may take a few seconds while Caddy gets the certificate)."
else
  echo "$DOMAIN does not resolve yet: add an A record pointing to this server, then open https://$DOMAIN"
fi
