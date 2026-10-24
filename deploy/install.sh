#!/usr/bin/env bash
# Installs, updates or removes VolleyIQ on a Docker host whose web server is Caddy (systemd).
#
#   sudo bash install.sh volleyiq.yourdomain.com              install or update
#   sudo bash install.sh --uninstall volleyiq.yourdomain.com  remove again (data kept as a backup)
#
# It only ever touches:
#   - /opt/volleyiq                      (code, .env, data/)
#   - the Docker project "volleyiq"      (one container, its image and network)
#   - one block in /etc/caddy/Caddyfile, between "# >>> volleyiq" / "# <<< volleyiq" markers
# Your other containers, images, build cache and Caddy sites are never modified.
# Before changing anything it shows the plan and asks for confirmation.
#
# Backups:
#   - the Caddyfile is copied to /etc/caddy/Caddyfile.bak-volleyiq-<time> before every change;
#     a change Caddy rejects is rolled back automatically, and a failed reload keeps the old config live
#   - the database is copied to /opt/volleyiq/data/backups/ before every update (last 10 kept)
#   - uninstall saves the database to /root/volleyiq-backup-<time>.db before removing anything
set -euo pipefail

DIR="${VOLLEYIQ_DIR:-/opt/volleyiq}"
REPO="${VOLLEYIQ_REPO:-https://github.com/fumeia/VolleyIQ.git}"
BRANCH="${BRANCH:-claude/volleyball-tagging-mobile-2dnlu1}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
PORT=3080
PROJECT=volleyiq
BEGIN="# >>> volleyiq (managed by install.sh, remove with --uninstall)"
END="# <<< volleyiq"
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
confirm() { read -rp "$1 [y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || { echo "Nothing changed."; exit 0; }; }

MODE=install
if [ "${1:-}" = "--uninstall" ]; then MODE=uninstall; shift; fi
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || die "usage: sudo bash install.sh [--uninstall] volleyiq.yourdomain.com"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid domain: $DOMAIN"
[ "$(id -u)" = 0 ] || die "please run with sudo"
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

has_caddy() { command -v caddy >/dev/null && [ -f "$CADDYFILE" ]; }
compose() { docker compose -p "$PROJECT" -f "$DIR/docker-compose.yml" --project-directory "$DIR" "$@"; }

CANDIDATE="$CADDYFILE.volleyiq-candidate"   # same folder, so relative imports resolve the same way

caddy_ok() { caddy validate --adapter caddyfile --config "$1" >/dev/null 2>&1; }

# Installs a validated candidate: backup, replace, reload; restores the backup if the reload fails.
apply_caddyfile() { # $1 = description
  if ! caddy_ok "$CANDIDATE"; then
    rm -f "$CANDIDATE"
    die "Caddy would reject the change ($1); the Caddyfile was not touched"
  fi
  local backup="$CADDYFILE.bak-volleyiq-$STAMP"
  cp -p "$CADDYFILE" "$backup"
  cat "$CANDIDATE" > "$CADDYFILE"
  rm -f "$CANDIDATE"
  if ! systemctl reload caddy; then
    cp -p "$backup" "$CADDYFILE"
    systemctl reload caddy || true
    die "Caddy reload failed ($1); the original Caddyfile was restored. To also remove VolleyIQ: sudo bash $0 --uninstall $DOMAIN"
  fi
  echo "Caddy updated: $1 (backup: $backup)"
}

with_block() { # prints the Caddyfile plus our managed block
  cat "$CADDYFILE"
  [ -z "$(tail -c1 "$CADDYFILE")" ] || echo   # make sure the file ends with a newline
  printf '%s\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:%s\n}\n%s\n' "$BEGIN" "$DOMAIN" "$PORT" "$END"
}

strip_block() { # prints the Caddyfile without our managed block
  awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1; next} $0==e{skip=0; next} !skip' "$CADDYFILE"
}

backup_db() { # $1 = destination
  [ -f "$DIR/data/volleyiq.db" ] || return 0
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$DIR/data/volleyiq.db" ".backup '$1'"   # consistent even while the app is running
  else
    cp -p "$DIR/data/volleyiq.db" "$1"
  fi
  echo "Database backed up to $1"
}

# ---------------------------------------------------------------- uninstall
if [ "$MODE" = uninstall ]; then
  say "Plan (uninstall)"
  echo " - save the database to /root/volleyiq-backup-$STAMP.db"
  echo " - stop and remove the VolleyIQ container, image and network (Docker project '$PROJECT' only)"
  if has_caddy && grep -qxF "$BEGIN" "$CADDYFILE"; then
    echo " - remove the VolleyIQ block from $CADDYFILE (backup kept)"
    strip_block > "$CANDIDATE"
    caddy_ok "$CANDIDATE" || { rm -f "$CANDIDATE"; die "Caddy would not accept the Caddyfile without the VolleyIQ block; nothing was changed"; }
    rm -f "$CANDIDATE"
  fi
  echo " - delete $DIR"
  confirm "Continue?"

  backup_db "/root/volleyiq-backup-$STAMP.db"
  if [ -f "$DIR/docker-compose.yml" ]; then
    compose down --rmi local --remove-orphans || true
  fi
  if has_caddy && grep -qxF "$BEGIN" "$CADDYFILE"; then
    strip_block > "$CANDIDATE"
    apply_caddyfile "removed $DOMAIN"
  fi
  rm -rf "$DIR"
  say "VolleyIQ removed. Database backup: /root/volleyiq-backup-$STAMP.db"
  echo "To restore later: install again, then copy the backup to $DIR/data/volleyiq.db and run: docker compose -p $PROJECT -f $DIR/docker-compose.yml restart"
  exit 0
fi

# ---------------------------------------------------------------- install / update
command -v git >/dev/null || die "git is not installed"
if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PORT\$" && ! compose ps -q 2>/dev/null | grep -q .; then
  die "port $PORT is already used by something else on this server"
fi
free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}' || true)
if [ -n "$free_mb" ] && [ "$free_mb" -lt 1500 ]; then
  die "only ${free_mb} MB free for Docker; the build needs about 1.5 GB temporarily"
fi

UPDATE=0; [ -d "$DIR/.git" ] && UPDATE=1
say "Plan ($([ $UPDATE = 1 ] && echo update || echo install))"
if [ $UPDATE = 1 ]; then
  echo " - back up the database to $DIR/data/backups/"
  echo " - update the code in $DIR (your .env and data/ stay as they are)"
else
  echo " - download the code to $DIR and ask for a login password"
fi
echo " - build and (re)start the VolleyIQ container on 127.0.0.1:$PORT (memory limit 192 MB)"
echo " - afterwards delete only VolleyIQ's own leftover build images/cache (nothing of your other projects)"
ADD_CADDY=0
if has_caddy; then
  if grep -qxF "$BEGIN" "$CADDYFILE"; then echo " - Caddy: VolleyIQ block already present, no change"
  elif grep -qE "^[[:space:]]*${DOMAIN//./\\.}([[:space:],{]|$)" "$CADDYFILE"; then echo " - Caddy: $DOMAIN already configured by you, no change"
  else
    # Check now, before anything changes, that Caddy will accept the new block.
    with_block > "$CANDIDATE"
    if ! caddy_ok "$CANDIDATE"; then
      rm -f "$CANDIDATE"
      caddy_ok "$CADDYFILE" || die "your current $CADDYFILE does not pass 'caddy validate'; fix it first. Nothing was changed."
      die "Caddy would reject the VolleyIQ block; nothing was changed"
    fi
    rm -f "$CANDIDATE"
    ADD_CADDY=1
    echo " - Caddy: add a block for $DOMAIN to $CADDYFILE (validated already; backup first, restored if the reload fails)"
  fi
fi
confirm "Continue?"

if [ $UPDATE = 1 ]; then
  mkdir -p "$DIR/data/backups"
  backup_db "$DIR/data/backups/volleyiq-$STAMP.db"
  ls -1t "$DIR"/data/backups/volleyiq-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f || true
  say "Updating the code"
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"   # tracked files only; .env and data/ are untracked
else
  say "Downloading the code"
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  say "Choose the VolleyIQ login password (for the website and the app)"
  while true; do
    read -rsp "Password: " pw1; echo
    read -rsp "Repeat:   " pw2; echo
    [ "$pw1" = "$pw2" ] && [ ${#pw1} -ge 8 ] && break
    echo "Passwords differ or are shorter than 8 characters, try again."
  done
  ( umask 077; printf 'APP_PASSWORD=%s\nSESSION_SECRET=%s\nPORT=%s\n' "$pw1" "$(openssl rand -hex 32)" "$PORT" > .env )
  unset pw1 pw2
fi
mkdir -p data

say "Building and starting the container"
old_image=$(docker images -q "${PROJECT}-app" 2>/dev/null | head -1 || true)
# Build cache is shared by all projects; only clean it if it was empty before (i.e. it is all ours).
cache_was_empty=0
docker system df --format '{{.Type}} {{.Size}}' 2>/dev/null | grep -qx 'Build Cache 0B' && cache_was_empty=1
compose up -d --build
new_image=$(docker images -q "${PROJECT}-app" 2>/dev/null | head -1 || true)
# Only VolleyIQ's own images: the previous version (if replaced) and its untagged build stages.
[ -n "$old_image" ] && [ "$old_image" != "$new_image" ] && docker rmi "$old_image" >/dev/null 2>&1 || true
docker image prune -f --filter "label=org.volleyiq.build=1" >/dev/null 2>&1 || true
if [ $cache_was_empty = 1 ]; then docker builder prune -af >/dev/null 2>&1 || true; else echo "Note: Docker build cache was not empty before, so it was left alone."; fi

for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && die "VolleyIQ did not start; see: docker compose -p $PROJECT -f $DIR/docker-compose.yml logs"
  sleep 1
done
echo "VolleyIQ is running on 127.0.0.1:$PORT"

if [ $ADD_CADDY = 1 ]; then
  say "Adding $DOMAIN to Caddy"
  with_block > "$CANDIDATE"
  apply_caddyfile "added $DOMAIN"
elif ! has_caddy; then
  say "Caddy not found: point your reverse proxy at 127.0.0.1:$PORT for $DOMAIN"
fi

say "DNS check"
if getent hosts "$DOMAIN" >/dev/null; then
  getent hosts "$DOMAIN"
  echo "Open https://$DOMAIN (the first visit can take a few seconds while Caddy gets the certificate)."
else
  echo "$DOMAIN does not resolve yet: add an A record pointing to this server, then open https://$DOMAIN"
fi
echo
echo "Undo everything at any time with: sudo bash $0 --uninstall $DOMAIN"
