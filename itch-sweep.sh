#!/bin/zsh
set -o pipefail

# ./itch-sweep.sh zip-file-name.zip
# Produces file zip-file-name.zip

ZIP_FILE_NAME=$1

V_SWEEP=$(cat sweep-version.txt)
SWEEP_ROOT="./scratch/itch-sweep-${V_SWEEP}"
SWEEP_V_URL="$V_SWEEP"
SWEEP_DEST="$SWEEP_ROOT/$SWEEP_V_URL/"


rm -rf "$SWEEP_ROOT"
mkdir -p "$SWEEP_DEST"

cp sweep.html "$SWEEP_ROOT/index.html"
cp charts.js "$SWEEP_DEST"
cp g.css "$SWEEP_DEST"
cp g.js "$SWEEP_DEST"
cp game-content.js "$SWEEP_DEST"
cp locale.js "$SWEEP_DEST"
cp richard/richard*.jpg "$SWEEP_DEST"
cp sweep-content.yaml "$SWEEP_DEST"
cp sweep-solver.js "$SWEEP_DEST"
cp sweep.js "$SWEEP_DEST"

sed -i "" -e "s|./sweep.js|./$SWEEP_V_URL/sweep.js|g" -e "s|./g.css|./$SWEEP_V_URL/g.css|g" -e "s|./richard/|./$SWEEP_V_URL/|g" "$SWEEP_ROOT/index.html"

sed -i "" -e "s|Game.isItch = false;|Game.isItch = true;|g" "$SWEEP_DEST/sweep.js"
