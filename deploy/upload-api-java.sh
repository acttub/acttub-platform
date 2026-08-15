#!/usr/bin/env bash
# back svc(Spring Boot) 배포 아티팩트를 만들어 S3에 올린다.
#
#   DEPLOY_BUCKET=acttub-deploy deploy/upload-api-java.sh
#
# 파이썬(upload-api.sh)은 소스를 보내고 인스턴스에서 `uv sync`로 의존성을 받지만,
# 자바는 bootJar 산출물 하나가 전부다 — 인스턴스에서 의존성을 받는 단계가 없다.
#
# 이 스크립트는 FastAPI 배포 경로를 건드리지 않는다. 이관이 끝날 때까지 be 는
# 파이썬이고, 여기서 올리는 것은 8080 에 나란히 뜨는 병행 인스턴스다.
set -euo pipefail

: "${DEPLOY_BUCKET:?배포 버킷 이름이 필요해요 (예: DEPLOY_BUCKET=acttub-deploy)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
JAR="apps/api-java/build/libs/acting-api.jar"

echo "▶ 빌드"
(cd apps/api-java && ./gradlew --quiet --console=plain bootJar)

[ -f "$JAR" ] || { echo "✗ jar 를 찾지 못했어요: $JAR" >&2; exit 1; }

echo "▶ 업로드 ($(du -h "$JAR" | cut -f1))"
aws s3 cp "$JAR" "s3://$DEPLOY_BUCKET/be-java/$TAG.jar"
aws s3 cp "$JAR" "s3://$DEPLOY_BUCKET/be-java/latest.jar"
aws s3 cp deploy/systemd/acttub-api-java.service \
  "s3://$DEPLOY_BUCKET/be-java/acttub-api-java.service"

cat <<EOF

✔ 업로드 완료: s3://$DEPLOY_BUCKET/be-java/$TAG.jar

설치는 SSM 으로 합니다:

  DEPLOY_BUCKET=$DEPLOY_BUCKET deploy/ssm-deploy.sh be-java i-0abc...

⚠ 그 DB 에 자바를 처음 붙이는 것이라면 Flyway baseline 이 먼저입니다. alembic 이
만든 스키마에는 flyway_schema_history 가 없어 그대로는 기동이 막힙니다:

  DEPLOY_BUCKET=$DEPLOY_BUCKET deploy/ssm-deploy.sh be-java-baseline i-0abc...   # 1회만
EOF
