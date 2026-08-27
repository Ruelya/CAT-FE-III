#!/usr/bin/env bash
# Turns the raw captures into shippable artifacts: WebP stills at half the
# capture scale, MP4 walkthroughs, and one contact sheet per study. Writes to
# both the repo (docs/design-studies/<study>/shots) and the review directory.
#
#   node src/build.mjs && PW=$(npm root -g)/playwright/index.mjs \
#     node src/shots.mjs && PW=... node src/walk.mjs && bash src/publish.sh
set -euo pipefail

SRC_SHOTS=/tmp/opus-shots
SRC_VIDEO=/tmp/opus-video
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ART=/opt/cursor/artifacts/themes/studies

STUDIES=(saas-opus-quarry saas-opus-cobalt saas-opus-ledger
         saas-opus-art-riso saas-opus-art-atelier saas-opus-art-phosphor
         saas-opus-art-vitrine saas-opus-art-atelier-light
         saas-opus-art-phosphor-light saas-opus-compact
         saas-opus-comfortable saas-opus-dark saas-opus-art-terra
         saas-opus-art-aurora saas-opus-art-blueprint saas-opus-art-acid)

mkdir -p "$ART"

for s in "${STUDIES[@]}"; do
  echo "== $s"
  rm -rf "${REPO:?}/$s/shots"
  mkdir -p "$REPO/$s/shots"

  for png in "$SRC_SHOTS/$s"/*.png; do
    name=$(basename "$png" .png)
    ffmpeg -hide_banner -loglevel error -y -i "$png" \
      -vf "scale=iw/2:-1:flags=lanczos" -quality 74 "$REPO/$s/shots/$name.webp"
  done

  # Contact sheet: the four states a reviewer looks at first.
  ffmpeg -hide_banner -loglevel error -y \
    -i "$SRC_SHOTS/$s/01-grid-imported.png" \
    -i "$SRC_SHOTS/$s/04-qa-unedited-fuzzy.png" \
    -i "$SRC_SHOTS/$s/06-agent-awaiting-review.png" \
    -i "$SRC_SHOTS/$s/27-proofread-chips.png" \
    -filter_complex \
      "[0]scale=600:-1[a];[1]scale=600:-1[b];[2]scale=600:-1[c];[3]scale=600:-1[d];\
       [a][b]hstack[t];[c][d]hstack[u];[t][u]vstack" \
    -quality 76 "$ART/$s-contact-sheet.webp"
done

du -sh "$REPO"/saas-opus-*/shots | sed 's/^/  /'
