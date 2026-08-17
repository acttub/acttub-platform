#!/usr/bin/env bash
# 🔁 **은퇴한 스크립트다 — 아무도 부르지 않는다**(SOMA-403 3단계). 파이썬이 사라지는
# 5단계에서 지운다.
#
# 배포한 코드가 기대하는 alembic 리비전과 DB의 현재 리비전이 맞는지 확인한다.
#
# 왜 있었나: 마이그레이션이 배포와 **별도 스텝**이라(ssm-deploy.sh 의 migrate 모드) head가
# 갈리거나 부분 적용되면 코드는 새것·DB는 구것인 상태가 남는데, 겉으로는 배포가 성공으로
# 보였다. 2026-08-01에 그 상태로 나가 커뮤니티 API가 며칠간 500이었다.
#
# 왜 필요 없어졌나: 스키마 정본이 Flyway 로 넘어가 마이그레이션이 **jar 기동의 일부**가
# 됐다. 실패하면 앱이 리슨을 시작하지 못하고 배포가 그 자리에서 실패한다 — 어긋난 채로
# 초록이 뜨는 창 자체가 사라졌다.
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

# ssm-deploy.sh 와 같은 방식으로 base64 한 줄로 넘긴다. `--parameters commands="[...]"`
# 축약 문법은 JSON 의 \n 이스케이프를 해석하지 않아서, 여러 줄 스크립트가 한 줄로
# 뭉개진 채 도착한다(원격에서 `set: Illegal option -c`). 그러면 출력이 비어 이 검사가
# 항상 "(확인 실패)" 로 끝난다 — 2026-08-13 에 dev·운영 둘 다 그 상태였다.
if base64 --help 2>&1 | grep -q ' -w'; then
  B64=$(printf '%s' "$REMOTE" | base64 -w0)   # GNU (Actions runner)
else
  B64=$(printf '%s' "$REMOTE" | base64)       # BSD (맥)
fi

CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --region "$REGION" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
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
  echo "### ⚠️ 스키마가 코드보다 뒤처져 있습니다"
  echo ""
  echo "배포 중 \`alembic upgrade head\`가 돌았는데도 어긋났다면, 마이그레이션이"
  echo "실패했거나 부분만 적용된 것입니다. 실행 로그의 \`▶ alembic upgrade head\`"
  echo "출력을 먼저 확인하세요."
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
