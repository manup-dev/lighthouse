#!/usr/bin/env bash
# One-command recovery after a reboot. Assumes:
#   - Ollama is managed by systemd (auto-starts on boot)
#   - GPU is healthy post-reboot (nvidia-smi works)
#
# Usage:
#   ./scripts/post-reboot.sh
#
# What it does:
#   1. Verifies GPU + Ollama are up
#   2. Ensures the 14B model is loaded on GPU, and verifies it's actually
#      resident on GPU (not silently CPU-fallback)
#   3. Starts API + web + cloudflared tunnel
#   4. Kicks off the gallery bake in the background (14B on GPU → ~5 min total)
#   5. Prints the new public URL and tails the bake progress
#
# Why the conservative NUM_CTX / NUM_PREDICT below:
#   The 5070 Ti has 16 GiB VRAM. 14B-q4 weights = ~8 GiB, KV cache scales
#   linearly with num_ctx. At 16k ctx the KV cache alone is ~3 GiB and peak
#   allocations during generation can exceed the 16 GiB card, which triggers
#   "CUDA error: unspecified launch failure" on the Blackwell 580.x driver
#   branch and wedges the GPU until a module reload. 8k ctx (KV ~1.5 GiB)
#   leaves enough headroom that the bake completes reliably.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── 1. checking GPU ─────────────────────────────────"
if ! nvidia-smi -L 2>/dev/null | grep -q GPU; then
  echo "  ✗ nvidia-smi can't see the GPU. Check the driver state before continuing." >&2
  echo "    sudo dmesg | tail -30 | grep -iE 'nvidia|nvrm'" >&2
  exit 1
fi
nvidia-smi -L | sed 's/^/  /'

echo ""
echo "── 2. checking Ollama ─────────────────────────────"
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "  ✓ ollama up"
    break
  fi
  if [[ $i -eq 5 ]]; then
    echo "  ✗ ollama not responding. sudo systemctl start ollama and retry." >&2
    exit 2
  fi
  sleep 1
done

echo ""
echo "── 3. warming 14B on GPU (one-time model load) ────"
# NUM_CTX here must match what the bake/runtime uses below — warming at a
# different ctx causes Ollama to reload at the real ctx on first real call,
# which doubles VRAM pressure at the worst possible moment.
curl -s -X POST http://127.0.0.1:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:14b-instruct-q4_K_M","messages":[{"role":"user","content":"hi"}],"stream":false,"options":{"num_ctx":8192}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('  ↳ loaded, first-token pass ok')" || {
    echo "  ✗ 14B model warmup failed — pull it first: ollama pull qwen2.5:14b-instruct-q4_K_M" >&2
    exit 3
  }
ollama ps | sed 's/^/  /'

# Verify the model is actually on GPU. Ollama has a nasty failure mode where
# the driver wedges mid-load and Ollama silently reloads onto CPU — every
# subsequent call then runs at ~10x slower and can OOM the host. Catch it
# here, loud, before the bake kicks off.
if ! ollama ps --format json 2>/dev/null | grep -q '"size_vram"[[:space:]]*:[[:space:]]*[1-9]'; then
  # Fallback: older ollama versions don't support --format json. Parse text.
  processor=$(ollama ps 2>/dev/null | awk 'NR>1 {for (i=1;i<=NF;i++) if ($i ~ /GPU|CPU/) {print $i; exit}}')
  if [[ "$processor" != *GPU* ]]; then
    echo "  ✗ model is NOT on GPU (processor=$processor). Driver likely wedged." >&2
    echo "    Run: sudo ./scripts/redeploy.sh gpu-reset   (or gpu-pci-reset)" >&2
    exit 4
  fi
fi
echo "  ✓ model resident on GPU"

echo ""
echo "── 4. starting API + web + tunnel ─────────────────"
# Conservative memory config — see header comment for reasoning. 8k ctx /
# 1k predict is enough for every stage in the pipeline (analyzer, thesis,
# query_plan, ranker, draft) and leaves ~3 GiB VRAM headroom on the 5070 Ti.
export OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M
export OLLAMA_NUM_CTX=8192
export OLLAMA_NUM_PREDICT=2048
./scripts/redeploy.sh --tunnel

TUNNEL_URL=$(cat /tmp/lighthouse-tunnel.url 2>/dev/null || echo "(not available)")

echo ""
echo "── 5. kicking off gallery bake (14B GPU, ~5 min) ──"
nohup env PYTHONUNBUFFERED=1 \
  OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M \
  OLLAMA_NUM_CTX=8192 \
  OLLAMA_NUM_PREDICT=2048 \
  uv run python -u scripts/bake_gallery.py --force \
  > /tmp/bake-gpu.log 2>&1 < /dev/null &
disown
sleep 2
echo "  ↳ baker pid=$(pgrep -f 'bake_gallery.py' | head -1)"
echo "  ↳ follow: tail -f /tmp/bake-gpu.log"

echo ""
echo "═══════════════════════════════════════════════════"
echo " public URL: $TUNNEL_URL"
echo " bake log:   /tmp/bake-gpu.log"
echo " api log:    /tmp/lighthouse-api.log"
echo " web log:    /tmp/lighthouse-web.log"
echo "═══════════════════════════════════════════════════"
