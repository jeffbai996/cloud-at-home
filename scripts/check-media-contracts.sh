#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
port=${MEDIA_CONTRACT_PORT:-18091}
url="http://127.0.0.1:${port}"
log_file="${TMPDIR:-/tmp}/cloud-media-contracts-$$.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT INT TERM

cd "$repo_root"
if ! grep -Fq 'html, body { overscroll-behavior-y: none; }' apps/media/src/media.css; then
  echo "media contract failed: Video must contain iOS top overscroll above navigation" >&2
  exit 1
fi
if grep -Fq 'video.webkitEnterFullscreen()' apps/media/src/Player.tsx; then
  echo "media contract failed: Video must never invoke native video fullscreen" >&2
  exit 1
fi

if grep -Fq 'webkitSetPresentationMode?.("fullscreen")' apps/media/src/Player.tsx; then
  echo "media contract failed: Video must never request WebKit presentation fullscreen" >&2
  exit 1
fi

if grep -Fq 'standardRequest ?? legacyRequest' apps/media/src/Player.tsx; then
  echo "media contract failed: Apple WebKit must never fall through to legacy shell fullscreen" >&2
  exit 1
fi
npm test -w @cloud-at-home/media
npm run typecheck -w @cloud-at-home/media
npm run build -w @cloud-at-home/media

npm run dev -w @cloud-at-home/media -- --host 127.0.0.1 --port "$port" --strictPort >"$log_file" 2>&1 &
server_pid=$!

for _ in {1..60}; do
  if curl --fail --silent --output /dev/null "$url"; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  sleep .25
done
curl --fail --silent --output /dev/null "$url"

MEDIA_E2E_URL="$url" npx playwright test tests/e2e/staging.spec.ts \
  --grep "Video keeps 14A and 18A|Video keeps touch fullscreen|Video starts front-page play commands|Video keyboard shortcuts preserve deliberate playback intent|Video contains top overscroll"
