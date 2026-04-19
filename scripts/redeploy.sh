#!/usr/bin/env bash
# Quick redeploy: kill stale servers, restart API + web, (optionally) open a
# public cloudflared tunnel. Designed so judges can hit ONE URL, while the
# heavy parts (FastAPI, Ollama) stay bound to loopback on this laptop.
#
# Usage:
#   ./scripts/redeploy.sh             # full bounce (api + web) on localhost
#   ./scripts/redeploy.sh api         # only restart FastAPI
#   ./scripts/redeploy.sh web         # only restart Next.js
#   ./scripts/redeploy.sh --tunnel    # full bounce + start cloudflared quick
#                                      tunnel, print the shareable URL
#   ./scripts/redeploy.sh tunnel-only # just start a tunnel for already-
#                                      running servers
#   sudo ./scripts/redeploy.sh gpu-reset
#                                    # try to unstick the NVIDIA driver when
#                                      nvidia-smi can't see the GPU. Safe-first
#                                      approach — just restarts Ollama; only
#                                      falls back to rmmod/modprobe if needed.
#
# Logs:
#   /tmp/lighthouse-{api,web,tunnel}.log
#   cat /tmp/lighthouse-tunnel.url   # latest cloudflared URL
#
# Free? Yes — cloudflared quick tunnels are free, need no Cloudflare account,
# and only proxy the one port you pass (:3737). FastAPI and Ollama are NOT
# exposed publicly because Next.js proxies /api/* internally over 127.0.0.1.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${LIGHTHOUSE_PORT:-8787}"
WEB_PORT=3737
API_LOG=/tmp/lighthouse-api.log
WEB_LOG=/tmp/lighthouse-web.log
TUNNEL_LOG=/tmp/lighthouse-tunnel.log
TUNNEL_URL_FILE=/tmp/lighthouse-tunnel.url
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"

MODE="${1:-both}"
START_TUNNEL=0
if [[ "$MODE" == "--tunnel" ]]; then
  MODE=both
  START_TUNNEL=1
elif [[ "$MODE" == "tunnel-only" ]]; then
  MODE=skip
  START_TUNNEL=1
fi

# ---- GPU reset (sudo) -----------------------------------------------------
gpu_check() {
  if nvidia-smi -L 2>/dev/null | grep -q GPU; then
    echo "  ✓ nvidia-smi sees GPU(s):"
    nvidia-smi -L | sed 's/^/    /'
    return 0
  fi
  echo "  ✗ nvidia-smi cannot see any GPU"
  return 1
}

gpu_reset() {
  if [[ "$EUID" -ne 0 ]]; then
    echo "✗ gpu-reset needs root. Run: sudo $0 gpu-reset" >&2
    exit 2
  fi
  echo "→ checking current GPU state"
  if gpu_check; then
    echo "  nothing to do — GPU already visible. Is Ollama just stuck?"
    echo "  restarting Ollama anyway so it re-probes the GPU…"
    systemctl restart ollama && sleep 1 && echo "  ✓ ollama restarted"
    return 0
  fi

  echo "→ who's holding /dev/nvidia*?"
  lsof /dev/nvidia* 2>/dev/null | sed 's/^/    /' || true

  # Step 1: stop Ollama so it releases any GPU handles.
  echo "→ stopping ollama.service"
  systemctl stop ollama || true
  sleep 1

  # Step 2: try the gentlest recovery — just restart the service. This re-
  # probes the driver without touching kernel modules. Works ~60% of the time
  # for transient Unknown-Error states.
  echo "→ attempting soft recovery: restart ollama and re-check"
  systemctl start ollama
  sleep 2
  if gpu_check; then
    echo "✓ soft recovery worked — no module reload needed."
    return 0
  fi

  # Step 3: module reload (last resort). Stop Ollama again so nothing holds
  # the module.
  echo "→ soft recovery failed — falling back to NVIDIA module reload"
  systemctl stop ollama || true
  sleep 1

  local holders
  holders=$(lsof /dev/nvidia* 2>/dev/null | awk 'NR>1 {print $2" "$1}' | sort -u)
  if [[ -n "$holders" ]]; then
    echo "  ✗ other processes still hold /dev/nvidia* — aborting for safety:"
    echo "$holders" | sed 's/^/    /'
    echo "  close those and retry (or pass --force)."
    [[ "${2:-}" != "--force" ]] && exit 3
  fi

  echo "→ rmmod nvidia_uvm nvidia_drm nvidia_modeset nvidia"
  modprobe -r nvidia_uvm nvidia_drm nvidia_modeset nvidia 2>&1 | sed 's/^/    /' || true
  sleep 1
  echo "→ modprobe nvidia"
  modprobe nvidia
  sleep 1

  if ! gpu_check; then
    echo "✗ GPU still not visible after reload. Likely firmware/hardware — try reboot." >&2
    systemctl start ollama || true
    exit 4
  fi

  echo "→ restarting ollama"
  systemctl start ollama
  sleep 2
  echo "✓ gpu-reset complete."
}

if [[ "$MODE" == "gpu-reset" ]]; then
  gpu_reset "$@"
  exit 0
fi

# ---- GPU PCIe rescan (no module unload) -----------------------------------
# Safer alternative to gpu-reset for remote-SSH situations where the 58-ref
# module can't be rmmod'd. Yanks the GPU out of /sys/bus/pci and rescans —
# forces the driver to renegotiate without touching kernel modules or the
# compositor's module handles. Does NOT reboot anything.
gpu_pci_reset() {
  if [[ "$EUID" -ne 0 ]]; then
    echo "✗ gpu-pci-reset needs root. Run: sudo $0 gpu-pci-reset" >&2
    exit 2
  fi
  local pci_addr
  pci_addr=$(lspci -D | awk '/VGA.*NVIDIA|3D.*NVIDIA/ {print $1; exit}')
  if [[ -z "$pci_addr" ]]; then
    echo "✗ no NVIDIA device found in lspci" >&2
    exit 3
  fi
  echo "→ target PCI device: $pci_addr"
  echo "→ stopping ollama (releases /dev/nvidia* handles)"
  systemctl stop ollama || true
  sleep 1

  # `lsof /dev/nvidia*` can block indefinitely when the GPU is wedged — cap
  # it so we never stall the reset. If the probe times out we print a
  # warning and proceed; any holders will just get broken handles, which is
  # exactly what we want anyway during a forced PCIe rescan.
  local holders
  holders=$(timeout 5 lsof /dev/nvidia* 2>/dev/null | awk 'NR>1 {print $2" "$1}' | sort -u || true)
  if [[ -n "$holders" ]]; then
    echo "  ↳ other GPU users (will be disrupted by rescan):"
    echo "$holders" | sed 's/^/      /'
    echo "  ↳ gnome-shell will crash cleanly — SSH and servers unaffected."
  else
    echo "  ↳ (no holders detected, or lsof blocked — proceeding anyway)"
  fi

  echo "→ removing $pci_addr from PCI tree"
  echo 1 > "/sys/bus/pci/devices/$pci_addr/remove"
  sleep 2
  echo "→ rescanning PCI bus"
  echo 1 > /sys/bus/pci/rescan
  sleep 3

  if gpu_check; then
    echo "→ restarting ollama"
    systemctl start ollama
    sleep 2
    echo "✓ gpu-pci-reset complete. Run: ollama ps"
    return 0
  fi

  echo "✗ GPU still not visible after rescan." >&2
  echo "  Check dmesg for driver errors:" >&2
  echo "  sudo dmesg | tail -30 | grep -i nvidia" >&2
  systemctl start ollama || true
  exit 4
}

if [[ "$MODE" == "gpu-pci-reset" ]]; then
  gpu_pci_reset
  exit 0
fi

# ---- kill stale -----------------------------------------------------------
# Find PIDs listening on a port. Some next-dev builds don't surface in lsof
# output even when they're clearly holding the port (seen with next 14.2.x),
# so fall back to `ss -tlnp` which parses /proc/net/tcp directly.
pids_on_port() {
  local port=$1
  local pids
  pids=$(lsof -t -i:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -z "$pids" ]]; then
    pids=$(ss -tlnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $6}' \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
  fi
  echo "$pids"
}

kill_port() {
  local port=$1
  local pids
  pids=$(pids_on_port "$port")
  if [[ -n "$pids" ]]; then
    echo "  ↳ killing pid(s) on :$port → $pids"
    kill $pids 2>/dev/null || true
    sleep 0.5
    pids=$(pids_on_port "$port")
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
      sleep 0.3
    fi
  fi
}

# ---- starters -------------------------------------------------------------
start_api() {
  echo "→ starting API on 127.0.0.1:$API_PORT (logs: $API_LOG)"
  kill_port "$API_PORT"
  : > "$API_LOG"
  # Bind to loopback only — the public tunnel only exposes the web port;
  # FastAPI stays off the public internet even if the tunnel is up.
  LIGHTHOUSE_PORT="$API_PORT" LIGHTHOUSE_HOST=127.0.0.1 \
    nohup uv run uvicorn lighthouse.api:app \
      --host 127.0.0.1 --port "$API_PORT" \
      >> "$API_LOG" 2>&1 &
  local pid=$!
  echo "  ↳ api pid=$pid"
  for i in $(seq 1 24); do
    if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
      echo "  ✓ api healthy"
      return 0
    fi
    sleep 0.5
  done
  echo "  ✗ api failed to come up — tail $API_LOG" >&2
  tail -n 20 "$API_LOG" >&2 || true
  return 1
}

start_web() {
  echo "→ starting web on :$WEB_PORT (logs: $WEB_LOG)"
  kill_port "$WEB_PORT"
  : > "$WEB_LOG"
  cd "$ROOT/surfaces/web"
  # Tell the Next.js rewrite where the local FastAPI lives so proxying
  # /api/* works regardless of the default port.
  LIGHTHOUSE_API_ORIGIN="http://127.0.0.1:$API_PORT" \
    nohup npx next dev -p "$WEB_PORT" >> "$WEB_LOG" 2>&1 &
  local pid=$!
  cd "$ROOT"
  echo "  ↳ web pid=$pid"
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null -w "%{http_code}" "http://127.0.0.1:$WEB_PORT" 2>/dev/null | grep -q "^[23]"; then
      echo "  ✓ web serving"
      return 0
    fi
    sleep 0.5
  done
  echo "  ✗ web failed to come up — tail $WEB_LOG" >&2
  tail -n 20 "$WEB_LOG" >&2 || true
  return 1
}

# ---- ollama sanity --------------------------------------------------------
check_ollama() {
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "  ✓ ollama reachable on 127.0.0.1:11434"
  else
    echo "  ⚠ ollama not reachable on 127.0.0.1:11434 — LLM calls will fail"
  fi
}

# ---- cloudflared ----------------------------------------------------------
ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED_BIN=$(command -v cloudflared)
    return 0
  fi
  if [[ -x "$CLOUDFLARED_BIN" ]]; then
    return 0
  fi
  echo "→ cloudflared not found — downloading to $CLOUDFLARED_BIN"
  mkdir -p "$(dirname "$CLOUDFLARED_BIN")"
  local arch
  arch=$(uname -m)
  local url
  case "$arch" in
    x86_64)  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
    aarch64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
    *)       echo "  ✗ unsupported arch: $arch — install cloudflared manually" >&2; return 1 ;;
  esac
  if ! curl -fsSL --retry 3 "$url" -o "$CLOUDFLARED_BIN"; then
    echo "  ✗ download failed — check network / install cloudflared manually" >&2
    return 1
  fi
  chmod +x "$CLOUDFLARED_BIN"
  echo "  ✓ cloudflared installed ($("$CLOUDFLARED_BIN" --version 2>&1 | head -1))"
}

kill_stale_tunnel() {
  # Kill any cloudflared process already proxying our web port.
  local pids
  pids=$(pgrep -f "cloudflared.*--url.*:$WEB_PORT" || true)
  if [[ -n "$pids" ]]; then
    echo "  ↳ killing stale tunnel pid(s) → $pids"
    kill $pids 2>/dev/null || true
    sleep 0.5
    pids=$(pgrep -f "cloudflared.*--url.*:$WEB_PORT" || true)
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

start_tunnel() {
  ensure_cloudflared || return 1
  kill_stale_tunnel
  : > "$TUNNEL_LOG"
  : > "$TUNNEL_URL_FILE"
  echo "→ opening cloudflared quick tunnel → http://127.0.0.1:$WEB_PORT (logs: $TUNNEL_LOG)"
  # --no-autoupdate avoids periodic version-check network calls.
  # --protocol http2: QUIC buffers SSE events aggressively on quick tunnels —
  # the browser never sees stage/log events until many KB have piled up. HTTP/2
  # with chunked transfer flushes per-event, which is what our live-trace UI
  # needs.
  nohup "$CLOUDFLARED_BIN" tunnel --no-autoupdate \
    --protocol http2 \
    --url "http://127.0.0.1:$WEB_PORT" \
    >> "$TUNNEL_LOG" 2>&1 &
  local pid=$!
  echo "  ↳ tunnel pid=$pid"
  # Wait up to 30s for a trycloudflare.com URL to appear in the logs.
  local url=""
  for i in $(seq 1 60); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
    if [[ -n "$url" ]]; then
      echo "$url" > "$TUNNEL_URL_FILE"
      echo "  ✓ public URL: $url"
      return 0
    fi
    sleep 0.5
  done
  echo "  ✗ tunnel did not produce a URL in 30s — tail $TUNNEL_LOG" >&2
  tail -n 20 "$TUNNEL_LOG" >&2 || true
  return 1
}

case "$MODE" in
  api)   start_api ;;
  web)   start_web ;;
  both)
    check_ollama
    start_api
    start_web
    ;;
  skip)  ;;
  *)
    echo "usage: $0 [api|web|--tunnel|tunnel-only]" >&2
    exit 2
    ;;
esac

[[ "$START_TUNNEL" == "1" ]] && start_tunnel || true

echo ""
echo "local:  http://127.0.0.1:$WEB_PORT"
echo "api:    http://127.0.0.1:$API_PORT/health"
echo "logs:   tail -F $API_LOG $WEB_LOG"
if [[ -s "$TUNNEL_URL_FILE" ]]; then
  echo ""
  echo "public: $(cat "$TUNNEL_URL_FILE")"
  echo "        (only the Next.js port is exposed — API + Ollama stay on 127.0.0.1)"
fi
