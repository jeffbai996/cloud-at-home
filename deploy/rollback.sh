#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")"
docker compose down
echo "Cloud Files staging stopped. FileBrowser remains unchanged on :8080."
