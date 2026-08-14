#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ASSET_DIR="$ROOT_DIR/docs/assets"
DEMO_DIR="$ROOT_DIR/docs/demo"
FRAME_DIR="$DEMO_DIR/frames"
OUTPUT="$DEMO_DIR/voiceops-linkedin-demo.mp4"

mkdir -p "$FRAME_DIR"

for overlay in title console-caption detail-caption admin-caption outro; do
  rsvg-convert -w 1080 -h 1350 "$DEMO_DIR/$overlay.svg" -o "$FRAME_DIR/$overlay.png"
done

magick "$ASSET_DIR/voiceops-product-console.png" \
  -resize '1200x1350^' -gravity center -extent 1080x1350 -blur 0x7 -modulate 72,80,100 \
  "$FRAME_DIR/title.png" -composite "$FRAME_DIR/00-title.png"

magick -size 1080x1350 canvas:'#090c0b' \
  \( "$ASSET_DIR/voiceops-product-console.png" -resize '1020x1020>' \) -gravity north -geometry +0+54 -composite \
  "$FRAME_DIR/console-caption.png" -composite "$FRAME_DIR/01-console.png"

magick -size 1080x1350 canvas:'#090c0b' \
  \( "$ASSET_DIR/voiceops-product-console.png" -crop '490x1090+980+360' +repage -resize '890x1020>' \) \
  -gravity north -geometry +0+48 -composite "$FRAME_DIR/detail-caption.png" -composite "$FRAME_DIR/02-detail.png"

magick -size 1080x1350 canvas:'#090c0b' \
  \( "$ASSET_DIR/voiceops-admin-dashboard.png" -resize '1020x1020>' \) -gravity north -geometry +0+54 -composite \
  "$FRAME_DIR/admin-caption.png" -composite "$FRAME_DIR/03-admin.png"

cp "$FRAME_DIR/outro.png" "$FRAME_DIR/04-outro.png"

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 4.4 -i "$FRAME_DIR/00-title.png" \
  -loop 1 -t 6.4 -i "$FRAME_DIR/01-console.png" \
  -loop 1 -t 5.4 -i "$FRAME_DIR/02-detail.png" \
  -loop 1 -t 6.4 -i "$FRAME_DIR/03-admin.png" \
  -loop 1 -t 5.4 -i "$FRAME_DIR/04-outro.png" \
  -f lavfi -t 25.4 -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -filter_complex "
    [0:v]fps=30,format=yuv420p,zoompan=z='min(zoom+0.00035,1.045)':d=132:s=1080x1350[v0];
    [1:v]fps=30,format=yuv420p,zoompan=z='min(zoom+0.00025,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=192:s=1080x1350[v1];
    [2:v]fps=30,format=yuv420p,zoompan=z='min(zoom+0.0003,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=162:s=1080x1350[v2];
    [3:v]fps=30,format=yuv420p,zoompan=z='min(zoom+0.00025,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=192:s=1080x1350[v3];
    [4:v]fps=30,format=yuv420p,zoompan=z='min(zoom+0.00025,1.035)':d=162:s=1080x1350[v4];
    [v0][v1]xfade=transition=fade:duration=0.6:offset=3.8[x1];
    [x1][v2]xfade=transition=fade:duration=0.6:offset=9.6[x2];
    [x2][v3]xfade=transition=fade:duration=0.6:offset=14.4[x3];
    [x3][v4]xfade=transition=fade:duration=0.6:offset=20.2,format=yuv420p[v]
  " \
  -map '[v]' -map 5:a -t 25.0 \
  -c:v libx264 -preset slow -crf 19 -profile:v high -level 4.1 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart "$OUTPUT"

printf '%s\n' "$OUTPUT"
