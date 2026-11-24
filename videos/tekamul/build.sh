#!/usr/bin/env bash
# Klipləri birləşdirir və referens kimi 9:16 çərçivəyə salır.
# İstifadə: bash build.sh [klip_qovluğu] [çıxış] [musiqi.mp3]
set -euo pipefail
cd "$(dirname "$0")"
CLIPS="${1:-clips}"; OUT="${2:-out/tekamul_9x16.mp4}"; MUSIC="${3:-}"
FONT="${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
L1="İnsanlığın milyon illik təkamülü"
L2="Son saniyəyə diqqət et"   # emoji drawtext-də görünmür, yayımda əlavə et
mkdir -p "$(dirname "$OUT")" .tmp
: > .tmp/list.txt
for f in "$CLIPS"/*.mp4; do
  n=".tmp/$(basename "$f")"
  ffmpeg -v error -y -i "$f" -an -vf "scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608,fps=30,setsar=1" -c:v libx264 -crf 18 -pix_fmt yuv420p "$n"
  echo "file '$(basename "$n")'" >> .tmp/list.txt
done
VF="pad=1080:1920:0:656:black,drawtext=fontfile=$FONT:text='$L1':fontcolor=white:fontsize=50:x=(w-tw)/2:y=500,drawtext=fontfile=$FONT:text='$L2':fontcolor=white:fontsize=50:x=(w-tw)/2:y=570"
if [ -n "$MUSIC" ]; then
  ffmpeg -v error -y -f concat -safe 0 -i .tmp/list.txt -i "$MUSIC" -vf "$VF" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest "$OUT"
else
  ffmpeg -v error -y -f concat -safe 0 -i .tmp/list.txt -vf "$VF" -c:v libx264 -crf 18 -pix_fmt yuv420p "$OUT"
fi
rm -rf .tmp
echo "Hazır: $OUT"
