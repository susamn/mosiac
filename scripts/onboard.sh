#!/usr/bin/env bash
# onboard.sh — convenience wrapper around the two-file-operation contract a
# data-app skill can also do itself, directly, without ever referencing this
# script or where this mosaic install lives:
#   mkdir -p ~/.local/share/mosaic/apps
#   ln -sfn <skill-path>/webapp ~/.local/share/mosaic/apps/<id>
# (see skill-creator's references/data-app-skills.md for the raw contract).
# This wrapper also redirects webapp/data into the centralized data home,
# migrating any pre-existing local data — a fallback for skills that didn't
# already write straight to the centralized home; see the same doc.
#
# Both directories are fixed and install-independent — mosaic reads apps
# from APPS_HOME regardless of where this script or mosaic's own code lives.
# Mirrors dotfiles/do-stow.sh's symlink-farm approach: no registration API,
# no restart — mosaic discovers apps by globbing APPS_HOME/*/app.json.
set -euo pipefail

usage() { echo "Usage: onboard.sh <path-to-app-webapp-dir>   (the dir containing app.json)"; exit 1; }
[[ $# -eq 1 ]] || usage
[[ -d "$1" ]] || { echo "[error] $1 is not a directory"; exit 1; }
SRC="$(cd "$1" && pwd)"
[[ -f "$SRC/app.json" ]] || { echo "[error] $SRC/app.json not found"; exit 1; }

ID="$(python3 -c "import json,sys;print(json.load(open('$SRC/app.json'))['id'])" 2>/dev/null)" \
  || { echo "[error] $SRC/app.json has no 'id' field or is not valid JSON"; exit 1; }
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "[error] app.json id '$ID' must be kebab-case (^[a-z0-9][a-z0-9-]*\$)"; exit 1; }

APPS_HOME="${MOSAIC_APPS_DIR:-$HOME/.local/share/mosaic/apps}"
DATA_HOME="${MOSAIC_DATA_HOME:-$HOME/.local/share/mosaic/data}"
DEST="$APPS_HOME/$ID"
CENTRAL="$DATA_HOME/$ID"
DATA_LINK="$SRC/data"
mkdir -p "$APPS_HOME" "$DATA_HOME"

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
