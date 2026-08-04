#!/usr/bin/env bash
# 배포한 코드가 기대하는 alembic 리비전과 DB의 현재 리비전이 맞는지 확인한다.
#
# 운영은 마이그레이션이 자동으로 돌지 않는다(ssm-deploy.sh의 MIGRATE는 dev 전용).
# 그래서 스키마 변경이 섞인 릴리스를 배포하면 코드는 새것, DB는 구것인 상태가
# 되는데, 겉으로는 배포가 성공으로 보인다. 2026-08-01에 그렇게 나가 커뮤니티
# API가 며칠간 500이었다(community_posts.anonymous 없음).
#
# 배포 자체를 막지는 않는다 — 새 마이그레이션 파일은 배포되어야 서버에 생기므로
# 사전 차단은 순환이 된다. 대신 어긋나면 잡을 실패로 만들어 눈에 띄게 한다.
set -euo pipefail

INSTANCE="${1:?인스턴스 ID가 필요해요 (예: i-0abc...)}"
REGION="${AWS_REGION:-ap-northeast-2}"

read -r -d '' REMOTE <<'EOS' || true
set -e
DB_URL=$(grep -m1 '^[[:space:]]*DATABASE_URL=' /etc/acttub/api.env | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')
[ -n "$DB_URL" ] || { echo "✗ api.env 에 DATABASE_URL이 없어요" >&2; exit 1; }
cd /svc/acttub/acttub-platform/apps/api/acting-api
# current는 DB가 실제로 올라간 리비전, heads는 배포된 코드가 기대하는 최신 리비전.
echo "CURRENT=$(sudo -u ubuntu env DATABASE_URL="$DB_URL" /usr/local/bin/uv run --no-dev alembic current 2>/dev/null | grep -oE '^[0-9a-z_]+' | head -1)"
echo "HEAD=$(sudo -u ubuntu env DATABASE_URL="$DB_URL" /usr/local/bin/uv run --no-dev alembic heads 2>/dev/null | grep -oE '^[0-9a-z_]+' | head -1)"
EOS

CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --region "$REGION" \
  --parameters commands="[$(printf '%s' "$REMOTE" | jq -Rs .)]" \
  --query 'Command.CommandId' --output text)

aws ssm wait command-executed \
  --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" 2>/dev/null || true

OUT=$(aws ssm get-command-invocation \
  --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" \
  --query 'StandardOutputContent' --output text)

CURRENT=$(printf '%s' "$OUT" | sed -n 's/^CURRENT=//p' | tr -d '[:space:]')
HEAD=$(printf '%s' "$OUT" | sed -n 's/^HEAD=//p' | tr -d '[:space:]')

echo "DB 리비전   : ${CURRENT:-(확인 실패)}"
echo "코드 리비전 : ${HEAD:-(확인 실패)}"

if [ -z "$CURRENT" ] || [ -z "$HEAD" ]; then
  echo "::warning::리비전을 확인하지 못했어요. SSM 출력을 직접 보세요."
  exit 0
fi

if [ "$CURRENT" = "$HEAD" ]; then
  echo "✓ 스키마가 코드와 맞습니다 ($CURRENT)"
  exit 0
fi

echo "::error::운영 DB 스키마가 배포된 코드보다 뒤처져 있어요 ($CURRENT → $HEAD). 마이그레이션을 실행하세요."
{
  echo "### ⚠️ 운영 마이그레이션이 필요합니다"
  echo ""
  echo "| | 리비전 |"
  echo "|---|---|"
  echo "| DB 현재 | \`$CURRENT\` |"
  echo "| 코드 기대 | \`$HEAD\` |"
  echo ""
  echo "SSM으로 접속해 실행하세요:"
  echo '```bash'
  echo "aws ssm start-session --target $INSTANCE"
  echo "DB_URL=\$(sudo grep -m1 '^[[:space:]]*DATABASE_URL=' /etc/acttub/api.env | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^\"//; s/\"\$//')"
  echo "sudo -u ubuntu env DATABASE_URL=\"\$DB_URL\" bash -c 'cd /svc/acttub/acttub-platform/apps/api/acting-api && /usr/local/bin/uv run --no-dev alembic upgrade head'"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 1
