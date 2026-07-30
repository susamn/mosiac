#!/usr/bin/env bash
# unboard.sh — detach an app (removes the symlink only; never touches the app's
# own source, static, or data — those live in the skill/app's own directory).
# Equivalent to: rm ~/.local/share/mosaic/apps/<id>
set -euo pipefail
usage() { echo "Usage: unboard.sh <app-id>"; exit 1; }
[[ $# -eq 1 ]] || usage
APPS_HOME="${MOSAIC_APPS_DIR:-$HOME/.local/share/mosaic/apps}"
DEST="$APPS_HOME/$1"
[[ -L "$DEST" ]] || { echo "[error] '$1' is not an onboarded app (no symlink at $DEST)"; exit 1; }
rm "$DEST"
echo "[unboard] '$1' detached"
