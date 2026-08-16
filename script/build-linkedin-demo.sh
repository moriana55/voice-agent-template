#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ASSET_DIR="$ROOT_DIR/docs/assets"
DEMO_DIR="$ROOT_DIR/docs/demo"
FRAME_DIR="$DEMO_DIR/frames"
OUTPUT="$DEMO_DIR/voiceops-linkedin-demo.mp4"
VOICED_OUTPUT="$DEMO_DIR/voiceops-linkedin-demo-voiced.mp4"
VOICEOVER="$DEMO_DIR/voiceops-demo-voiceover.mp3"
FPS=30

mkdir -p "$FRAME_DIR"

for overlay in title console-caption detail-caption admin-caption outro; do
  rsvg-convert -w 1080 -h 1350 "$DEMO_DIR/$overlay.svg" -o "$FRAME_DIR/$overlay.png"
done

magick "$ASSET_DIR/voiceops-product-console.png" \
  -resize '1200x1350^' -gravity center -extent 1080x1350 -blur 0x7 -modulate 72,80,100 \
  "$FRAME_DIR/title.png" -composite "$FRAME_DIR/00-title.png"

magick -size 1080x1350 canvas:'#090c0b' \
  \( "$ASSET_DIR/voiceops-english-conversation-step1.png" -crop '490x390+980+0' +repage -resize '920x732!' \) \
  -gravity north -geometry +0+420 -composite \
  "$FRAME_DIR/console-caption.png" -composite "$FRAME_DIR/01-console.png"

magick -size 1080x1350 canvas:'#090c0b' \
  \( "$ASSET_DIR/voiceops-english-conversation-complete.png" -crop '490x375+980+405' +repage -resize '920x704!' \) \
  -gravity north -geometry +0+390 -composite "$FRAME_DIR/detail-caption.png" -composite "$FRAME_DIR/02-detail.png"

magick "$ASSET_DIR/voiceops-admin-dashboard.png" \
  -resize '1200x1350^' -gravity center -extent 1080x1350 -blur 0x8 -modulate 65,72,100 \
  "$FRAME_DIR/admin-caption.png" -composite "$FRAME_DIR/03-admin.png"

cp "$FRAME_DIR/outro.png" "$FRAME_DIR/04-outro.png"

ffmpeg -hide_banner -loglevel error -y \
  -framerate "$FPS" -loop 1 -t 4.2 -i "$FRAME_DIR/00-title.png" \
  -framerate "$FPS" -loop 1 -t 14.0 -i "$FRAME_DIR/01-console.png" \
  -framerate "$FPS" -loop 1 -t 7.0 -i "$FRAME_DIR/02-detail.png" \
  -framerate "$FPS" -loop 1 -t 7.0 -i "$FRAME_DIR/03-admin.png" \
  -framerate "$FPS" -loop 1 -t 6.2 -i "$FRAME_DIR/04-outro.png" \
  -f lavfi -t 37.5 -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -filter_complex "
    [0:v]scale=4320:5400:flags=lanczos,format=yuv420p,zoompan=z='1+0.045*on/125':d=126:s=1080x1350:fps=$FPS[v0];
    [1:v]scale=4320:5400:flags=lanczos,format=yuv420p,zoompan=z='1+0.045*on/419':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=420:s=1080x1350:fps=$FPS[v1];
    [2:v]scale=4320:5400:flags=lanczos,format=yuv420p,zoompan=z='1+0.05*on/209':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=210:s=1080x1350:fps=$FPS[v2];
    [3:v]scale=4320:5400:flags=lanczos,format=yuv420p,zoompan=z='1+0.045*on/209':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=210:s=1080x1350:fps=$FPS[v3];
    [4:v]scale=4320:5400:flags=lanczos,format=yuv420p,zoompan=z='1+0.035*on/185':d=186:s=1080x1350:fps=$FPS[v4];
    [v0][v1]xfade=transition=fadeblack:duration=0.35:offset=3.85[x1];
    [x1][v2]xfade=transition=fadeblack:duration=0.35:offset=17.5[x2];
    [x2][v3]xfade=transition=fadeblack:duration=0.35:offset=24.15[x3];
    [x3][v4]xfade=transition=fadeblack:duration=0.35:offset=30.8,fps=$FPS,format=yuv420p[v]
  " \
  -map '[v]' -map 5:a -t 37.0 \
  -c:v libx264 -preset slow -crf 18 -profile:v high -level 4.1 -pix_fmt yuv420p -g 60 \
  -c:a aac -b:a 96k -movflags +faststart "$OUTPUT"

if [ -f "$VOICEOVER" ]; then
  ffmpeg -hide_banner -loglevel error -y \
    -i "$OUTPUT" -i "$VOICEOVER" \
    -filter_complex "[1:a]highpass=f=90,agate=threshold=0.035:ratio=8:attack=5:release=80:range=0.02,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-38dB:start_silence=0.02:stop_periods=-1:stop_duration=0.28:stop_threshold=-38dB:stop_silence=0.08,adelay=250|250,apad=pad_dur=37,atrim=0:37,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=34.3:d=0.7[a]" \
    -map 0:v:0 -map '[a]' -c:v copy -c:a aac -b:a 192k -movflags +faststart -t 37 \
    "$VOICED_OUTPUT"
fi

printf '%s\n' "$OUTPUT"
[ ! -f "$VOICEOVER" ] || printf '%s\n' "$VOICED_OUTPUT"
