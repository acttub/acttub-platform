# Trusted media fixtures

These fixtures are generated with the pinned linux/amd64 FFmpeg 7.1.1 image:

```sh
IMAGE='lscr.io/linuxserver/ffmpeg@sha256:e67aaccb6806b3358db8ebb0d3165714131f737eba914171e05acd7f9a751a91'
DIR="$PWD/apps/web/tests/fixtures/media"

docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -v "$DIR:/fixtures" --entrypoint /usr/local/bin/ffmpeg "$IMAGE" -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=16x16:r=1:d=600" -an -c:v libx264 -preset veryslow -pix_fmt yuv420p -video_track_timescale 1000 /fixtures/valid-600000ms.mp4
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -v "$DIR:/fixtures" --entrypoint /usr/local/bin/ffmpeg "$IMAGE" -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=16x16:r=1:d=180" -an -c:v libx264 -preset veryslow -pix_fmt yuv420p -video_track_timescale 1000 /fixtures/valid-180000ms.mp4
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -v "$DIR:/fixtures" --entrypoint /usr/local/bin/ffmpeg "$IMAGE" -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=16x16:r=1000:d=180.001" -an -c:v libx264 -preset veryslow -pix_fmt yuv420p -video_track_timescale 1000 /fixtures/valid-180001ms.mp4
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -v "$DIR:/fixtures" --entrypoint /usr/local/bin/ffmpeg "$IMAGE" -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=16x16:r=1:d=1" -an -c:v libx264 -preset veryslow -pix_fmt yuv420p -video_track_timescale 1000 /fixtures/valid.mp4
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -v "$DIR:/fixtures" --entrypoint /usr/local/bin/ffmpeg "$IMAGE" -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=16x16:r=1:d=1" -an -c:v libx264 -preset veryslow -pix_fmt yuv420p -video_track_timescale 1000 /fixtures/valid.mov
cp "$DIR/valid.mov" "$DIR/mov-brand-as-mp4.mp4"
cp "$DIR/valid.mp4" "$DIR/mp4-brand-as-mov.mov"
printf '\\x00\\x00\\x00\\x18ftypisom\\x00\\x00\\x02\\x00isomiso2' > "$DIR/corrupt-truncated.mp4"
```

Runtime validation uses the matching `/usr/local/bin/ffprobe` entrypoint with
`-v error -show_streams -show_format -of json`.

## SHA-256

```text
c8c5af84ac765d911a9ab05bc9a19d15d0b1bc5cf0654eff4469ce536410654e  corrupt-truncated.mp4
f40dce096b475f5c7e2b082886edfe4625a4eb1cf9202890e5e0fd60555d029d  mov-brand-as-mp4.mp4
a1ea7b9a37ea2b6c8ee9febacd59f6bc9cd867c97a5cb6befcac67bd555f6f1d  mp4-brand-as-mov.mov
b7fbf89cc35718d0c5c8f48cbbb915eaf26beb68d412e283bf57e78b345fc81e  valid-180000ms.mp4
07d82741e30871f5ec85f5bf7f7f84d6046b62b1d26e50c513c4f98f5e192b16  valid-180001ms.mp4
3e02badfbf91e62131be1cc1b20662146fea09f8f9611aaeb943577f274f67cb  valid-600000ms.mp4
f40dce096b475f5c7e2b082886edfe4625a4eb1cf9202890e5e0fd60555d029d  valid.mov
a1ea7b9a37ea2b6c8ee9febacd59f6bc9cd867c97a5cb6befcac67bd555f6f1d  valid.mp4
```
