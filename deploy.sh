#!/bin/bash
set -o pipefail

DEST=$1

cp charts.js "$DEST"
cp city-content.yaml "$DEST"
cp city-core.js "$DEST"
cp city-icon-180.png "$DEST"
cp city-icon-192.png "$DEST"
cp city-index.js "$DEST"
cp g.css "$DEST"
cp city.css "$DEST"
cp city.html "$DEST"
cp city.js "$DEST"
cp g.js "$DEST"
cp game-content.js "$DEST"
cp index.html "$DEST"
cp locale.js "$DEST"
cp sprites.html "$DEST"
cp sprites.js "$DEST"
cp -R spritesheets/ "$DEST/spritesheets/"
cp terrain.html "$DEST"
cp terrain.js "$DEST"
cp tests.html "$DEST"
cp tests.js "$DEST"

V_SWEEP=$(cat sweep-version.txt)
SWEEP_ROOT="$DEST/sweep"
SWEEP_V_URL="$V_SWEEP"
SWEEP_DEST="$SWEEP_ROOT/$SWEEP_V_URL/"

echo "Deploying sweep version $V_SWEEP"

mkdir -p "$SWEEP_DEST"

cp sweep.html "$SWEEP_ROOT/index.html"
cp charts.js "$SWEEP_DEST"
cp g.css "$SWEEP_DEST"
cp city.css "$SWEEP_DEST"
cp g.js "$SWEEP_DEST"
cp game-content.js "$SWEEP_DEST"
cp locale.js "$SWEEP_DEST"
cp sweep-content.yaml "$SWEEP_DEST"
cp sweep-solver.js "$SWEEP_DEST"
cp sweep.js "$SWEEP_DEST"

sed -i -e "s|./sweep.js|./$SWEEP_V_URL/sweep.js|g" -e "s|./city.css|./$SWEEP_V_URL/city.css|g" "$SWEEP_ROOT/index.html"

V_CIV=$(cat version.txt)
CIV_ROOT="$DEST/civ"
CIV_V_LIB_URL="$V_CIV"
CIV_V_APP_URL="$V_CIV/app"
CIV_LIB_PATH="$CIV_ROOT/$CIV_V_LIB_URL/"
CIV_APP_PATH="$CIV_ROOT/$CIV_V_APP_URL/"

echo "Deploying civ version $_CIV"

mkdir -p "$CIV_APP_PATH"

cd civ
cp index.html "$CIV_ROOT/index.html"
cp ../g.css ../g.js ../game-content.js ../locale.js "$CIV_LIB_PATH"
cp civ.js content.yaml game.js ui-drawables.js ui-game.js ui-system.js "$CIV_APP_PATH"
cp objects-640.png terrain-base-640.jpg terrain-edge-640.png "$CIV_APP_PATH"
cd -

sed -i -e "s|./civ.js|./$CIV_V_APP_URL/civ.js|g" -e "s|./civ.css|./$CIV_V_APP_URL/civ.css|g" -e "s|./g.css|./$CIV_V_LIB_URL/g.css|g" "$CIV_ROOT/index.html"


echo "Deployment complete."
