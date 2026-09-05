#!/usr/bin/env bash
# 계측 키가 개인정보처리방침 고지보다 앞서지 않는지 — 웹을 배포하기 전에 deploy.yml 이 부른다
# (prod 의 fe 잡과 dev 의 build_web 잡이 같은 검사를 받는다).
#
#   AMPLITUDE_KEY=<이 환경의 vars.AMPLITUDE_API_KEY_WEB> deploy/consent-gate.sh
#
# 계측 키를 넣는 것과 방침에 고지하는 것은 순서를 틀리면 되돌릴 수 없다. 키가 먼저 들어가면
# 고지 없이 이용 기록과 화면 녹화가 수탁사로 넘어간다. 사람이 기억할 일로 두지 않고 여기서
# 막는다. 키가 비어 있으면 통과한다 — 계측이 꺼진 번들이 나갈 뿐이라 안전한 상태다.
#
# 판정 둘: ① 발행 중인 방침 문서에 Amplitude 위탁 고지가 있다, ② 웹이 기대하는 방침 버전
# (EXPECTED_PRIVACY_VERSION)이 발행 버전과 같다. 실패 이유는 Actions 의 잡 요약
# ($GITHUB_STEP_SUMMARY, 있을 때)에도 적는다.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -z "${AMPLITUDE_KEY:-}" ]; then
  echo "Amplitude 키가 없습니다 — 계측이 꺼진 번들로 배포합니다."
  exit 0
fi

MANIFEST=apps/api/src/main/resources/consent-docs/manifest.json
PRIVACY_FILE=$(jq -r '.[] | select(.type=="privacy") | .file' "$MANIFEST")
PRIVACY_VERSION=$(jq -r '.[] | select(.type=="privacy") | .version' "$MANIFEST")
PRIVACY_PATH="apps/api/src/main/resources/consent-docs/$PRIVACY_FILE"

if ! grep -q "Amplitude" "$PRIVACY_PATH"; then
  echo "::error::발행 중인 개인정보처리방침($PRIVACY_FILE)에 Amplitude 위탁 고지가 없는데 계측 키가 설정돼 있습니다."
  {
    echo "### 배포를 멈췄습니다"
    echo "\`$PRIVACY_FILE\` 에 Amplitude 가 없습니다. 이대로 나가면 고지 없이 이용 기록과"
    echo "화면 녹화가 수탁사로 전송됩니다."
    echo ""
    echo "**둘 중 하나를 하세요.**"
    echo "1. 방침을 먼저 발행한다 — \`apps/api/src/main/resources/consent-docs/README.md\` 의 순서를 따르세요."
    echo "2. 지금 배포에서 계측을 끈다 — 이 환경의 \`AMPLITUDE_API_KEY_WEB\` 변수를 비우세요."
  } >> "$SUMMARY"
  exit 1
fi

EXPECTED=$(grep -oE 'EXPECTED_PRIVACY_VERSION = "[^"]+"' apps/web/src/features/auth/pending-consents.ts | grep -oE '"[^"]+"' | tr -d '"')
if [ "$EXPECTED" != "$PRIVACY_VERSION" ]; then
  echo "::error::웹이 기대하는 방침 버전($EXPECTED)과 발행 중인 버전($PRIVACY_VERSION)이 다릅니다."
  {
    echo "### 배포를 멈췄습니다"
    echo "\`EXPECTED_PRIVACY_VERSION\` = \`$EXPECTED\`, manifest 발행 버전 = \`$PRIVACY_VERSION\`."
    echo "이 둘이 어긋나면 동의 게이트가 영영 열리지 않거나(계측이 조용히 죽음),"
    echo "옛 버전 동의자에게 새 수집을 적용하게 됩니다."
  } >> "$SUMMARY"
  exit 1
fi

echo "방침 $PRIVACY_VERSION($PRIVACY_FILE)에 Amplitude 고지가 있고 웹 기대 버전과 일치합니다."
