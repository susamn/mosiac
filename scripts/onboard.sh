#!/usr/bin/env bash
# onboard.sh — attach an app to mosaic by symlinking its webapp/ folder in,
# and redirect its data/ into mosaic's centralized data home so every app's
# data lives under one rclone-able root regardless of where the app's own
# source lives on disk.
#
# Mirrors dotfiles/do-stow.sh's symlink-farm approach: no registration API,
# no restart — mosaic discovers apps by globbing apps/*/app.json on request.
set -euo pipefail

usage() { echo "Usage: onboard.sh <path-to-app-webapp-dir>   (the dir containing app.json)"; exit 1; }
[[ $# -eq 1 ]] || usage
[[ -d "$1" ]] || { echo "[error] $1 is not a directory"; exit 1; }
SRC="$(cd "$1" && pwd)"
[[ -f "$SRC/app.json" ]] || { echo "[error] $SRC/app.json not found"; exit 1; }

ID="$(python3 -c "import json,sys;print(json.load(open('$SRC/app.json'))['id'])" 2>/dev/null)" \
  || { echo "[error] $SRC/app.json has no 'id' field or is not valid JSON"; exit 1; }
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "[error] app.json id '$ID' must be kebab-case (^[a-z0-9][a-z0-9-]*\$)"; exit 1; }

MOSAIC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_HOME="${MOSAIC_DATA_HOME:-$HOME/.local/share/mosaic/data}"
DEST="$MOSAIC_DIR/apps/$ID"
CENTRAL="$DATA_HOME/$ID"
DATA_LINK="$SRC/data"
mkdir -p "$MOSAIC_DIR/apps" "$DATA_HOME"

# ── app symlink: apps/<id> -> SRC ──────────────────────────────────────────
if [[ -L "$DEST" ]]; then
  CUR="$(readlink -f "$DEST")"
  if [[ "$CUR" == "$SRC" ]]; then
    echo "[onboard] '$ID' already onboarded from $SRC"
  else
    echo "[onboard] Replacing existing link for '$ID' ($CUR -> $SRC)"
    rm "$DEST"
    ln -s "$SRC" "$DEST"
  fi
elif [[ -e "$DEST" ]]; then
  echo "[error] $DEST exists and is not a symlink — refusing to overwrite"
  exit 1
else
  ln -s "$SRC" "$DEST"
fi
echo "[onboard] $ID -> $SRC"

# ── data symlink: SRC/data -> DATA_HOME/<id> ───────────────────────────────
mkdir -p "$CENTRAL"
if [[ -L "$DATA_LINK" ]]; then
  CUR_DATA="$(readlink -f "$DATA_LINK")"
  if [[ "$CUR_DATA" != "$(readlink -f "$CENTRAL")" ]]; then
    echo "[onboard] Repointing data link for '$ID' ($CUR_DATA -> $CENTRAL)"
    rm "$DATA_LINK"
    ln -s "$CENTRAL" "$DATA_LINK"
  fi
elif [[ -d "$DATA_LINK" ]]; then
  if [[ -n "$(ls -A "$DATA_LINK" 2>/dev/null)" ]]; then
    echo "[onboard] Migrating existing data from $DATA_LINK to $CENTRAL"
    cp -a "$DATA_LINK/." "$CENTRAL/"
  fi
  rm -rf "$DATA_LINK"
  ln -s "$CENTRAL" "$DATA_LINK"
elif [[ -e "$DATA_LINK" ]]; then
  echo "[error] $DATA_LINK exists and is neither a directory nor a symlink — refusing to touch it"
  exit 1
else
  ln -s "$CENTRAL" "$DATA_LINK"
fi
echo "[onboard] data -> $CENTRAL (back the whole of $DATA_HOME with rclone to archive every app's data at once)"
echo "[onboard] Live at /mosaic/apps/$ID/ once mosaic is running (no restart needed)"
