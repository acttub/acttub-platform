#!/usr/bin/env bash
# S3에 올라간 아티팩트를 인스턴스에 설치하고 서비스를 재시작한다.
#
#   DEPLOY_BUCKET=acttub-deploy deploy/ssm-deploy.sh fe i-0abc...
#
# SSM Run Command로 실행하므로 인스턴스에 네트워크로 접근하지 않는다. AWS API에
# "이 인스턴스에서 이걸 실행해줘"라고 시키면 인스턴스의 SSM Agent가 받아 실행한다.
# 그래서 private subnet이어도, GitHub Actions runner에서도 그대로 동작한다.
set -euo pipefail

: "${DEPLOY_BUCKET:?배포 버킷 이름이 필요해요 (예: DEPLOY_BUCKET=acttub-deploy)}"
SIDE="${1:?fe 또는 be를 지정해주세요}"
INSTANCE="${2:?인스턴스 ID가 필요해요 (예: i-0abc...)}"

# MIGRATE=1 이면 be 설치 중에 alembic upgrade head까지 돌린다. dev·운영 모두
# 켜서 돌린다 — 운영만 수동으로 두면 코드는 새것·DB는 구것인 창이 생기고,
# 2026-08-01에 그 창으로 커뮤니티 API가 며칠간 500이었다(docs/DEPLOY-VPC.md 6-4).
#
# 인용된 heredoc(<<'EOS')이라 여기서는 아무것도 확장되지 않고, 원격에서 실행될 때
# 비로소 평가된다. SSM Run Command는 systemd가 아니라서 EnvironmentFile을 타지
# 않으므로, alembic env.py가 요구하는 DATABASE_URL을 api.env에서 직접 뽑아 넘긴다
# (값에 선행 공백이나 따옴표가 있을 수 있어 걷어낸다).
MIGRATE_STEP=""
if [ "${MIGRATE:-}" = "1" ]; then
  MIGRATE_STEP=$(cat <<'EOS'
DB_URL=$(grep -m1 '^[[:space:]]*DATABASE_URL=' /etc/acttub/api.env | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')
[ -n "$DB_URL" ] || { echo "✗ /etc/acttub/api.env 에 DATABASE_URL이 없어요" >&2; exit 1; }
echo "▶ alembic upgrade head"
sudo -u ubuntu env DATABASE_URL="$DB_URL" bash -c 'cd /svc/acttub/acttub-platform/apps/api/acting-api && /usr/local/bin/uv run --no-dev alembic upgrade head'
EOS
)
fi

case "$SIDE" in
  fe)
    REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
aws s3 cp "s3://$DEPLOY_BUCKET/fe/latest.tar.gz" /tmp/web.tar.gz
# 이전 배포 잔여물을 남기지 않는다. 삭제된 청크가 남으면 오래된 자산이 섞인다.
rm -rf /svc/acttub/web/*
tar xzf /tmp/web.tar.gz -C /svc/acttub/web
chown -R ubuntu:ubuntu /svc/acttub/web
aws s3 cp "s3://$DEPLOY_BUCKET/fe/acttub-web.service" /etc/systemd/system/acttub-web.service
systemctl daemon-reload
systemctl enable acttub-web
systemctl restart acttub-web
sleep 3
systemctl is-active acttub-web
EOF
)
    SERVICE=acttub-web
    ;;
  be)
    REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
aws s3 cp "s3://$DEPLOY_BUCKET/be/latest.tar.gz" /tmp/api.tar.gz
rm -rf /svc/acttub/acttub-platform/apps/api
tar xzf /tmp/api.tar.gz -C /svc/acttub/acttub-platform/apps
chown -R ubuntu:ubuntu /svc/acttub
# .venv는 반드시 ubuntu 소유여야 한다 — 서비스가 그 계정으로 돈다.
sudo -u ubuntu bash -c 'cd /svc/acttub/acttub-platform/apps/api && /usr/local/bin/uv sync'
# 마이그레이션은 새 코드로, 재시작 전에 돈다(MIGRATE=1 일 때만 내용이 들어간다).
$MIGRATE_STEP
aws s3 cp "s3://$DEPLOY_BUCKET/be/acttub-api.service" /etc/systemd/system/acttub-api.service
# 릴리스 이름은 배포마다 바뀌므로 drop-in 으로 얹는다. /etc/acttub/api.env 는 사람이
# 관리하는 파일이라(DSN·환경 이름이 거기 있다) 배포 스크립트가 건드리지 않는다.
# drop-in 의 Environment= 는 유닛의 EnvironmentFile= 보다 나중에 적용돼 이긴다.
mkdir -p /etc/systemd/system/acttub-api.service.d
printf '[Service]\nEnvironment=SENTRY_RELEASE=%s\n' '${RELEASE:-unknown}' \
  > /etc/systemd/system/acttub-api.service.d/sentry-release.conf
systemctl daemon-reload
systemctl enable acttub-api
# 자동 재시작 카운터를 0으로 맞춰두고 시작한다 — 아래 NRestarts 확인의 기준점이다.
systemctl reset-failed acttub-api || true
systemctl restart acttub-api
sleep 8
systemctl is-active acttub-api
# Type=simple은 exec 직후 곧바로 active가 되므로 is-active만으로는 기동에 실패해
# 크래시루프 중인 프로세스도 성공으로 읽힌다. S3 자격증명을 못 찾으면 앱이 기동을
# 거부하므로(config.py·app.py) 이 확인이 없으면 전면 장애가 배포 성공으로 기록된다.
# 수동 restart는 카운터를 올리지 않으니, 0이 아니면 자동 재시작이 돌았다는 뜻이다.
test "\$(systemctl show -p NRestarts --value acttub-api)" = "0"
EOF
)
    SERVICE=acttub-api
    ;;
  # 이관 병행 기동. FastAPI(be)는 그대로 두고 자바를 8001에 나란히 올린다.
  # 프록시 대상이 바뀌지 않으므로 이 배포만으로는 트래픽이 이동하지 않는다.
  be-java)
    REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
# jar 만 보내므로 인스턴스에 JRE 가 필요하다. 없으면 여기서 깐다.
if ! command -v java >/dev/null 2>&1; then
  echo "▶ JRE 21 설치"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless
fi
install -d -o ubuntu -g ubuntu /svc/acttub/api-java
aws s3 cp "s3://$DEPLOY_BUCKET/be-java/latest.jar" /svc/acttub/api-java/acting-api.jar
chown ubuntu:ubuntu /svc/acttub/api-java/acting-api.jar
aws s3 cp "s3://$DEPLOY_BUCKET/be-java/acttub-api-java.service" /etc/systemd/system/acttub-api-java.service
systemctl daemon-reload
systemctl enable acttub-api-java
systemctl reset-failed acttub-api-java || true
systemctl restart acttub-api-java
# JVM 기동은 파이썬보다 느리다. Flyway 검증까지 끝나야 리슨을 시작한다.
sleep 20
systemctl is-active acttub-api-java
# Type=simple 은 exec 직후 곧바로 active 이므로 is-active 만으로는 크래시루프도
# 성공으로 읽힌다. 스키마 검증 실패·DB 접속 실패가 여기서 걸린다.
test "\$(systemctl show -p NRestarts --value acttub-api-java)" = "0"
curl -fsS --max-time 5 http://127.0.0.1:8001/health > /dev/null
EOF
)
    SERVICE=acttub-api-java
    ;;
  # alembic 이 만든 스키마에는 flyway_schema_history 가 없어 자바가 그대로는 뜨지
  # 않는다. DB 마다 최초 1회만 돌린다. 이 모드는 마이그레이션을 실행하지 않는다.
  be-java-baseline)
    REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
test -f /svc/acttub/api-java/acting-api.jar || { echo "✗ jar 가 없어요 — be-java 배포가 먼저입니다" >&2; exit 1; }
mkdir -p /etc/systemd/system/acttub-api-java.service.d
printf '[Service]\nEnvironment=FLYWAY_BASELINE_ONLY=true\n' \
  > /etc/systemd/system/acttub-api-java.service.d/flyway-baseline.conf
systemctl daemon-reload
systemctl restart acttub-api-java
sleep 20
journalctl -u acttub-api-java -n 40 --no-pager | grep -i 'FLYWAY_BASELINE_ONLY' || true
# 기록이 끝나면 즉시 되돌린다. 남겨두면 빈 DB 에서도 V1 을 건너뛰게 된다.
rm -f /etc/systemd/system/acttub-api-java.service.d/flyway-baseline.conf
systemctl daemon-reload
systemctl reset-failed acttub-api-java || true
systemctl restart acttub-api-java
sleep 20
systemctl is-active acttub-api-java
test "\$(systemctl show -p NRestarts --value acttub-api-java)" = "0"
EOF
)
    SERVICE=acttub-api-java
    ;;
  *)
    echo "✗ fe · be · be-java · be-java-baseline 중 하나여야 해요 (받은 값: $SIDE)" >&2
    exit 1
    ;;
esac

# 스크립트를 base64로 감싸 한 줄로 넘긴다. 따옴표·개행이 JSON 파라미터를 깨뜨리는
# 것을 원천적으로 막는다.
if base64 --help 2>&1 | grep -q ' -w'; then
  B64=$(printf '%s' "$REMOTE_SCRIPT" | base64 -w0)   # GNU (Actions runner)
else
  B64=$(printf '%s' "$REMOTE_SCRIPT" | base64)       # BSD (맥)
fi

echo "▶ $SIDE → $INSTANCE 에 설치 명령 전송"
CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --comment "deploy $SIDE" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query 'Command.CommandId' --output text)

echo "  command id: $CMD_ID"

# 실패해도 wait이 non-zero로 끝나므로, 상태는 아래에서 직접 조회해 판정한다.
aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE" || true

STATUS=$(aws ssm get-command-invocation \
  --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query 'Status' --output text)

echo "--- stdout ---"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query 'StandardOutputContent' --output text
STDERR=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query 'StandardErrorContent' --output text)
if [ -n "$STDERR" ] && [ "$STDERR" != "None" ]; then
  echo "--- stderr ---"
  echo "$STDERR"
fi

if [ "$STATUS" != "Success" ]; then
  echo "✗ 배포 실패 ($STATUS)" >&2
  exit 1
fi

echo "✔ $SERVICE 배포 완료"
