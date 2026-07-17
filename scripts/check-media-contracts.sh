#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if ! grep -Eq '\.rating-badge-triangle \{[^}]*font-family: "DM Sans"' apps/media/src/media.css; then
  echo "media contract failed: 14A/18A triangles must use DM Sans" >&2
  exit 1
fi

if ! grep -Fq 'return /iPhone|iPod/.test(userAgent);' apps/media/src/playback.ts; then
  echo "media contract failed: iPad must not use native video fullscreen" >&2
  exit 1
fi

if ! grep -Fq 'usesNativeVideoFullscreen(navigator.userAgent)' apps/media/src/Player.tsx; then
  echo "media contract failed: player must not pass iPad touch capability into native fullscreen" >&2
  exit 1
fi

npm run check:public
npm test -w @cloud-at-home/media
npm run typecheck -w @cloud-at-home/media
npm run build -w @cloud-at-home/media
