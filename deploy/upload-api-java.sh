#!/usr/bin/env bash
# back svc(Spring Boot) 배포 아티팩트를 만들어 S3에 올린다.
#
#   DEPLOY_BUCKET=acttub-deploy deploy/upload-api-java.sh
#
# 배포 아티팩트는 bootJar 산출물 하나가 전부다 — 인스턴스에서 의존성을 받는 단계가 없다.
#
# 📌 **이름의 `-java` 는 디렉토리가 아니라 systemd 유닛(`acttub-api-java`)을 따른다.**
# 소스는 `apps/api` 로 이사했지만(SOMA-403 5단계) 인스턴스에서 돌고 있는 유닛 이름을
# 바꾸는 것은 배포가 아니라 이행이라 함께 하지 않았다. 유닛을 개명할 때 이 이름도 같이
# 간다.
set -euo pipefail

: "${DEPLOY_BUCKET:?배포 버킷 이름이 필요해요 (예: DEPLOY_BUCKET=acttub-deploy)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
JAR="apps/api/build/libs/acting-api.jar"

echo "▶ 빌드"
(cd apps/api && ./gradlew --quiet --console=plain bootJar)

[ -f "$JAR" ] || { echo "✗ jar 를 찾지 못했어요: $JAR" >&2; exit 1; }

# 프리픽스는 파이썬이 쓰던 것과 같은 be/ 다. be/ 는 "back svc 인스턴스에 갈 산출물"
# 이라는 뜻이고 jar 도 그것이다.
#
# 따로 be-java/ 를 두면 인스턴스 role 에 프리픽스를 하나 더 허용해야 한다. 운영
# 정책(acttub-be-deploy)은 be/* 로 좁혀 둔 상태라 그 특례가 손으로 관리되는 IAM 에만
# 남고 레포에는 안 남는다 — 2026-08-17 운영 컷오버가 그 403 으로 한 번 멈췄다.
echo "▶ 업로드 ($(du -h "$JAR" | cut -f1))"
aws s3 cp "$JAR" "s3://$DEPLOY_BUCKET/be/$TAG.jar"
aws s3 cp "$JAR" "s3://$DEPLOY_BUCKET/be/latest.jar"
aws s3 cp deploy/systemd/acttub-api-java.service \
  "s3://$DEPLOY_BUCKET/be/acttub-api-java.service"

cat <<EOF

✔ 업로드 완료: s3://$DEPLOY_BUCKET/be/$TAG.jar

설치는 SSM 으로 합니다:

  DEPLOY_BUCKET=$DEPLOY_BUCKET deploy/ssm-deploy.sh be-java i-0abc...

⚠ 그 DB 에 자바를 처음 붙이는 것이라면 Flyway baseline 이 먼저입니다. 이관 전부터
있던 스키마에는 flyway_schema_history 가 없어 그대로는 기동이 막힙니다:

  DEPLOY_BUCKET=$DEPLOY_BUCKET deploy/ssm-deploy.sh be-java-baseline i-0abc...   # 1회만
EOF
