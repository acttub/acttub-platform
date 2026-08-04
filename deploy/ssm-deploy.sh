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

# MIGRATE=1 이면 be 설치 중에 alembic upgrade head까지 돌린다. dev 전용이다 —
# prod는 스키마 변경을 되돌리기 어려워 수동으로 실행한다(docs/DEPLOY-VPC.md 4-3).
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
systemctl daemon-reload
systemctl enable acttub-api
systemctl restart acttub-api
sleep 3
systemctl is-active acttub-api
EOF
)
    SERVICE=acttub-api
    ;;
  *)
    echo "✗ fe 또는 be만 지정할 수 있어요 (받은 값: $SIDE)" >&2
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
