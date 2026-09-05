#!/usr/bin/env bash
# GHCR 에 이미지 태그가 이미 있는지 — deploy.yml 의 build_api·build_web 이 같은 sha 를 다시 굽지
# 않으려고 부른다. 다시 구우면 jar 타임스탬프·Next 빌드 ID 가 달라져 다이제스트가 바뀌고, 서버의
# compose 가 같은 코드를 새 컨테이너로 다시 띄운다.
#
#   deploy/ghcr-image-exists.sh ghcr.io/acttub/acttub-platform/api:<sha>
#
# 종료 코드 셋을 구분한다 — "없다" 와 "모른다" 를 같이 취급하면 GHCR 이 잠깐 안 닿은 것만으로
# 다시 구워 위 재생성이 일어난다.
#   0  있다
#   1  없다(또는 이 자격으로는 못 본다) — manifest unknown(로그인 상태) · denied(익명·패키지 없음) ·
#      unauthorized(익명·private 패키지). deploy_home 은 로그인 없이 부르므로 private 이면 여기다
#   2  판정 불가 — 네트워크·레지스트리 오류. 부르는 쪽이 실패로 둔다
# 실측(2026-09-03, docker 29): 없는 태그·아직 없는 패키지 모두 로그인 뒤엔 "manifest unknown",
# 익명이면 "denied", 익명으로 private 패키지를 보면 "unauthorized"(Actions 첫 실행에서 확인).
# 호스트를 못 찾으면 "failed to configure transport … no such host".
set -euo pipefail

IMAGE="${1:?이미지 참조가 필요하다 (예: ghcr.io/acttub/acttub-platform/api:<sha>)}"

if out="$(docker manifest inspect "$IMAGE" 2>&1 >/dev/null)"; then
  echo "있다: $IMAGE"
  exit 0
fi
case "$out" in
  *"manifest unknown"*|*denied*|*unauthorized*|*"not found"*)
    echo "없다: $IMAGE ($out)"
    exit 1 ;;
  *)
    echo "✗ 판정 불가: $IMAGE — $out" >&2
    exit 2 ;;
esac
