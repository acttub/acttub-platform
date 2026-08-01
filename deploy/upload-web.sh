#!/usr/bin/env bash
# front svc 배포 아티팩트를 만들어 S3에 올린다. 로컬(맥)에서 실행한다.
#
#   DEPLOY_BUCKET=acttub-deploy API_ORIGIN=http://back-alb-xxx.ap-northeast-2.elb.amazonaws.com \
#     deploy/upload-web.sh
set -euo pipefail

: "${DEPLOY_BUCKET:?배포 버킷 이름이 필요해요 (예: DEPLOY_BUCKET=acttub-deploy)}"
: "${API_ORIGIN:?back alb 주소가 필요해요 (예: API_ORIGIN=http://back-alb-xxx.elb.amazonaws.com)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
TARBALL="$(mktemp -u).tar.gz"
trap 'rm -rf "$STAGE" "$TARBALL"' EXIT

echo "▶ 빌드 (API_ORIGIN=$API_ORIGIN)"
# API_ORIGIN·NEXT_PUBLIC_* 는 빌드 시점에 굳는다. 런타임 환경변수로는 안 바뀐다.
API_ORIGIN="$API_ORIGIN" \
NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-}" \
  pnpm --filter web build:server

echo "▶ 패키징 (sharp 제외)"
# standalone에는 빌드한 플랫폼 전용 sharp 바이너리가 딸려온다(맥이면 darwin-arm64).
# images.unoptimized를 켜도 Next의 의존성 트레이싱이 무조건 포함시키므로 여기서 뺀다.
# 이미지 최적화를 쓰지 않아 실제로 로드되지 않는다.
rsync -a --exclude '*sharp*' apps/web/.next/standalone/ "$STAGE/"
# standalone은 정적 자산을 포함하지 않는다. 빠뜨리면 스타일 없는 화면이 뜬다.
mkdir -p "$STAGE/apps/web/.next"
cp -R apps/web/.next/static "$STAGE/apps/web/.next/static"
cp -R apps/web/public "$STAGE/apps/web/public"

# 플랫폼 종속 바이너리가 남아 있으면 리눅스에서 안 뜬다. 올리기 전에 막는다.
if find "$STAGE" -name '*.node' | grep -q .; then
  echo "✗ 네이티브 바이너리가 남아 있어요 — 리눅스에서 기동에 실패합니다:" >&2
  find "$STAGE" -name '*.node' >&2
  exit 1
fi

tar czf "$TARBALL" -C "$STAGE" .
echo "▶ 업로드 ($(du -h "$TARBALL" | cut -f1))"
aws s3 cp "$TARBALL" "s3://$DEPLOY_BUCKET/fe/$TAG.tar.gz"
# latest는 인스턴스에서 늘 같은 명령으로 받기 위한 별칭이다.
aws s3 cp "$TARBALL" "s3://$DEPLOY_BUCKET/fe/latest.tar.gz"
aws s3 cp deploy/systemd/acttub-web.service "s3://$DEPLOY_BUCKET/fe/acttub-web.service"

cat <<EOF

✔ 업로드 완료: s3://$DEPLOY_BUCKET/fe/$TAG.tar.gz

front svc 인스턴스에서 이어서 실행하세요:

  aws s3 cp s3://$DEPLOY_BUCKET/fe/latest.tar.gz /tmp/web.tar.gz
  sudo rm -rf /svc/acttub/web/* && sudo tar xzf /tmp/web.tar.gz -C /svc/acttub/web
  sudo chown -R ubuntu:ubuntu /svc/acttub/web
  aws s3 cp s3://$DEPLOY_BUCKET/fe/acttub-web.service /tmp/
  sudo mv /tmp/acttub-web.service /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now acttub-web
  systemctl status acttub-web --no-pager
EOF
