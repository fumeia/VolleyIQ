#!/usr/bin/env bash
# VolleyIQ server diagnosis. READ-ONLY: it only reads system state and prints a
# report; it changes nothing, installs nothing and sends nothing anywhere.
# Secrets are never printed: config files are only grepped for host/port lines,
# and anything that looks like a password/token/key is masked.
#
# Usage: bash diagnose.sh [your-domain.com]
# The report is printed and also saved to ./volleyiq-diagnose.txt

DOMAIN="${1:-}"
OUT="volleyiq-diagnose.txt"

mask() { sed -E 's/((pass(word)?|secret|token|key|auth)[^=: ]*[=: ]+)[^ ;"]+/\1****/Ig'; }
section() { printf '\n===== %s =====\n' "$1"; }
run() { "$@" 2>&1 | mask || true; }
have() { command -v "$1" >/dev/null 2>&1; }

report() {
  section "system"
  run uname -srm
  [ -r /etc/os-release ] && grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release
  run uptime
  echo "cpus: $(nproc 2>/dev/null)"

  section "memory (MB)"
  run free -m

  section "disk"
  run df -h -x tmpfs -x devtmpfs -x squashfs -x overlay

  section "docker"
  if have docker; then
    run docker version --format 'client {{.Client.Version}} / server {{.Server.Version}}'
    echo "--- containers"
    run docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    echo "--- live usage"
    run docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
    echo "--- compose projects"
    run docker compose ls
    echo "--- networks"
    run docker network ls --format 'table {{.Name}}\t{{.Driver}}'
    echo "--- disk usage"
    run docker system df
    echo "--- reverse-proxy labels (traefik / caddy-docker-proxy)"
    for c in $(docker ps -q 2>/dev/null); do
      docker inspect --format '{{.Name}}{{range $k, $v := .Config.Labels}}{{"\n  "}}{{$k}}={{$v}}{{end}}' "$c" 2>/dev/null \
        | grep -E '^/|traefik\.http\.routers\..*\.rule|traefik\.enable|^  caddy|VIRTUAL_HOST' | grep -B1 -E '^  ' | mask
    done
  else
    echo "docker not installed"
  fi

  section "listening ports"
  if have ss; then run ss -tlnH; elif have netstat; then run netstat -tln; else echo "no ss/netstat"; fi

  section "web servers / reverse proxies"
  for s in nginx caddy apache2 httpd traefik haproxy; do
    if have systemctl && systemctl list-unit-files "$s.service" >/dev/null 2>&1 && systemctl list-unit-files "$s.service" | grep -q "$s"; then
      echo "$s.service: $(systemctl is-active "$s" 2>/dev/null)"
    fi
    have "$s" && echo "$s binary: $(command -v "$s")"
  done
  for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [ -d "$d" ] || continue
    echo "--- $d (server_name / listen / proxy_pass lines only)"
    grep -HnE '^\s*(server_name|listen|proxy_pass|client_max_body_size)\b' "$d"/* 2>/dev/null | mask
  done
  for f in /etc/caddy/Caddyfile /etc/caddy/conf.d/*; do
    [ -f "$f" ] || continue
    echo "--- $f (site addresses / reverse_proxy lines only)"
    grep -nE '^[^[:space:]#].*\{\s*$|reverse_proxy' "$f" 2>/dev/null | mask
  done
  [ -d /etc/letsencrypt/live ] && { echo "--- certificates"; ls /etc/letsencrypt/live 2>&1; }

  section "tools"
  for t in git node npm python3 sqlite3 ffmpeg; do
    printf '%-8s %s\n' "$t" "$(have "$t" && "$t" --version 2>&1 | head -1 || echo '-')"
  done

  if [ -n "$DOMAIN" ]; then
    section "dns for $DOMAIN"
    run getent hosts "$DOMAIN"
    run getent hosts "volleyiq.$DOMAIN"
  fi

  section "done"
  echo "Nothing was changed on this server."
}

report | tee "$OUT"
echo
echo "Saved to $(pwd)/$OUT. Paste its contents back to Claude."
