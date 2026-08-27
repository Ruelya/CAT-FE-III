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
ART=/opt/cursor/artifacts/design-opus-tune

STUDIES=(saas-opus-quarry saas-opus-cobalt saas-opus-ledger
         saas-opus-art-riso saas-opus-art-atelier saas-opus-art-phosphor
         saas-opus-art-vitrine saas-opus-art-atelier-light
         saas-opus-art-phosphor-light)

rm -rf "$ART"
mkdir -p "$ART"

for s in "${STUDIES[@]}"; do
  echo "== $s"
  rm -rf "${REPO:?}/$s/shots"
  mkdir -p "$REPO/$s/shots" "$ART/$s"

  for png in "$SRC_SHOTS/$s"/*.png; do
    name=$(basename "$png" .png)
    ffmpeg -hide_banner -loglevel error -y -i "$png" \
      -vf "scale=iw/2:-1:flags=lanczos" -quality 74 "$REPO/$s/shots/$name.webp"
    cp "$REPO/$s/shots/$name.webp" "$ART/$s/$name.webp"
  done

  # Walkthroughs stay out of the repo — they are review artifacts, and the
  # material studies (grain, noise, light) make them expensive to version.
  if [ -f "$SRC_VIDEO/$s.webm" ]; then
    ffmpeg -hide_banner -loglevel error -y -i "$SRC_VIDEO/$s.webm" \
      -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart \
      -vf "scale=1400:-2" "$ART/$s/walkthrough.mp4"
  fi

  # Contact sheet: the four states a reviewer looks at first.
  ffmpeg -hide_banner -loglevel error -y \
    -i "$SRC_SHOTS/$s/01-grid-imported.png" \
    -i "$SRC_SHOTS/$s/04-qa-unedited-fuzzy.png" \
    -i "$SRC_SHOTS/$s/06-agent-awaiting-review.png" \
    -i "$SRC_SHOTS/$s/27-proofread-chips.png" \
    -filter_complex \
      "[0]scale=820:-1[a];[1]scale=820:-1[b];[2]scale=820:-1[c];[3]scale=820:-1[d];\
       [a][b]hstack[t];[c][d]hstack[u];[t][u]vstack" \
    -quality 84 "$ART/$s/contact-sheet.webp"
done

du -sh "$ART" "$REPO"/saas-opus-*/shots | sed 's/^/  /'
