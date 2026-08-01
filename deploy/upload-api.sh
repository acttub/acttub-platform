#!/usr/bin/env bash
# back svc 배포 아티팩트를 만들어 S3에 올린다. 로컬(맥)에서 실행한다.
#
#   DEPLOY_BUCKET=acttub-deploy deploy/upload-api.sh
#
# 파이썬은 소스를 그대로 보내고 인스턴스에서 `uv sync`로 의존성을 받는다.
# uv.lock에 git 의존성이 없어 인스턴스에 git이 필요 없다.
set -euo pipefail

: "${DEPLOY_BUCKET:?배포 버킷 이름이 필요해요 (예: DEPLOY_BUCKET=acttub-deploy)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
TARBALL="$(mktemp -u).tar.gz"
trap 'rm -f "$TARBALL"' EXIT

echo "▶ 패키징"
# .venv는 플랫폼 종속이라 절대 보내지 않는다 — 인스턴스에서 uv sync로 새로 만든다.
# .env도 보내지 않는다. 운영 값은 /etc/acttub/api.env가 담당한다.
tar czf "$TARBALL" \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.env' \
  --exclude='.pytest_cache' \
  --exclude='.ruff_cache' \
  -C apps api

echo "▶ 업로드 ($(du -h "$TARBALL" | cut -f1))"
aws s3 cp "$TARBALL" "s3://$DEPLOY_BUCKET/api/$TAG.tar.gz"
aws s3 cp "$TARBALL" "s3://$DEPLOY_BUCKET/api/latest.tar.gz"
aws s3 cp deploy/systemd/acttub-api.service "s3://$DEPLOY_BUCKET/api/acttub-api.service"

cat <<EOF

✔ 업로드 완료: s3://$DEPLOY_BUCKET/api/$TAG.tar.gz

back svc 인스턴스에서 이어서 실행하세요:

  aws s3 cp s3://$DEPLOY_BUCKET/api/latest.tar.gz /tmp/api.tar.gz
  sudo rm -rf /svc/acttub/acttub-platform/apps/api
  sudo tar xzf /tmp/api.tar.gz -C /svc/acttub/acttub-platform/apps
  sudo chown -R ubuntu:ubuntu /svc/acttub
  sudo -u ubuntu bash -c 'cd /svc/acttub/acttub-platform/apps/api && uv sync'
  aws s3 cp s3://$DEPLOY_BUCKET/api/acttub-api.service /tmp/
  sudo mv /tmp/acttub-api.service /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now acttub-api
  systemctl status acttub-api --no-pager

마이그레이션(빈 DB 최초 1회):

  sudo -u ubuntu bash -c 'cd /svc/acttub/acttub-platform/apps/api/acting-api && uv run alembic upgrade head'
EOF
