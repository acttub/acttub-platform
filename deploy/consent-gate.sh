#!/usr/bin/env bash
# 계측 키가 고지와 동의보다 앞서지 않는지 — 웹을 배포하기 전에 deploy.yml 이 부른다
# (prod 의 fe 잡과 dev 의 build_web 잡이 같은 검사를 받는다).
#
#   AMPLITUDE_KEY=<이 환경의 vars.AMPLITUDE_API_KEY_WEB> deploy/consent-gate.sh
#
# 계측 키를 넣는 것과 고지하는 것은 순서를 틀리면 되돌릴 수 없다. 키가 먼저 들어가면
# 고지 없이 이용 기록과 화면 녹화가 수탁사로 넘어간다. 사람이 기억할 일로 두지 않고 여기서
# 막는다. 키가 비어 있으면 통과한다 — 계측이 꺼진 번들이 나갈 뿐이라 안전한 상태다.
#
# 1.0.0 부터 문서가 둘로 갈린다(SOMA-528). 개인정보 처리방침은 동의 대상이 아닌 고지
# (consent-docs/privacy_policy.md, 공개 API 로 내준다)이고, 배우가 결정하는 문서는
# manifest 의 privacy 종류인 "개인정보 수집·이용 동의"다. 판정 둘:
#   ① 처리방침(고지)에 Amplitude 위탁 고지가 있다.
#   ② 발행 중인 수집·이용 동의 문서에 그 수집 항목이 적혀 있다 — 웹은 이 문서의 현재 판에
#      동의한 사람에게만 계측을 켠다.
# 웹이 방침 판을 상수로 들고 있던 검사(EXPECTED_PRIVACY_VERSION)는 없앴다. 웹은 판 번호를
# 들지 않고 서버의 GET /v2/consents/entry 가 현재 판 기준으로 답한 결정만 본다
# (apps/web/ANALYTICS.md). 그래서 새 수집이 생기는 변경은 고지만 고치지 말고 수집·이용 동의의
# 판도 올려야 한다 — 그래야 기존 동의자가 다시 결정하고 그 전까지 계측이 꺼진다
# (consent-docs/README.md 의 발행 규칙).
# 실패 이유는 Actions 의 잡 요약($GITHUB_STEP_SUMMARY, 있을 때)에도 적는다.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -z "${AMPLITUDE_KEY:-}" ]; then
  echo "Amplitude 키가 없습니다 — 계측이 꺼진 번들로 배포합니다."
  exit 0
fi

# 테스트가 다른 문서 묶음을 가리킬 수 있게 디렉터리만 바꿀 수 있다. 배포에서는 쓰지 않는다.
DOCS="${CONSENT_DOCS_DIR:-apps/api/src/main/resources/consent-docs}"
MANIFEST="$DOCS/manifest.json"
NOTICE_FILE=privacy_policy.md
NOTICE_PATH="$DOCS/$NOTICE_FILE"
# 번역본이 나란히 실릴 수 있다(SOMA-544). 발행의 정본은 한국어 행이다.
PRIVACY_FILE=$(jq -r '.[] | select(.type=="privacy" and ((.locale // "ko") == "ko")) | .file' "$MANIFEST")
PRIVACY_VERSION=$(jq -r '.[] | select(.type=="privacy" and ((.locale // "ko") == "ko")) | .version' "$MANIFEST")
PRIVACY_PATH="$DOCS/$PRIVACY_FILE"

stop() {
  # $1 = 어느 파일, $2 = 무엇이 없는지
  echo "::error::$2($1)에 Amplitude 가 없는데 계측 키가 설정돼 있습니다."
  {
    echo "### 배포를 멈췄습니다"
    echo "\`$1\` 에 Amplitude 가 없습니다. 이대로 나가면 고지·동의 없이 이용 기록과"
    echo "화면 녹화가 수탁사로 전송됩니다."
    echo ""
    echo "**둘 중 하나를 하세요.**"
    echo "1. 문서를 먼저 발행한다 — \`apps/api/src/main/resources/consent-docs/README.md\` 의 순서를 따르세요."
    echo "2. 지금 배포에서 계측을 끈다 — 이 환경의 \`AMPLITUDE_API_KEY_WEB\` 변수를 비우세요."
  } >> "$SUMMARY"
  exit 1
}

if [ ! -f "$NOTICE_PATH" ] || ! grep -q "Amplitude" "$NOTICE_PATH"; then
  stop "$NOTICE_FILE" "개인정보 처리방침 고지"
fi

if [ -z "$PRIVACY_FILE" ] || [ ! -f "$PRIVACY_PATH" ] || ! grep -q "Amplitude" "$PRIVACY_PATH"; then
  stop "${PRIVACY_FILE:-manifest 의 privacy 문서}" "발행 중인 개인정보 수집·이용 동의"
fi

echo "처리방침 고지($NOTICE_FILE)와 수집·이용 동의 $PRIVACY_VERSION($PRIVACY_FILE)에 Amplitude 가 적혀 있습니다."
