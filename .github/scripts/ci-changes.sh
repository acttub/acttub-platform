#!/usr/bin/env bash
# ci.yml 의 경로 판정(SOMA-552). web·api·mobile·smoke·smoke-monitoring·smoke-restore 잡이 각각 부르고
# 결과를 $GITHUB_OUTPUT 에 쓴다.
#   api        — apps/api 의 Gradle 테스트
#   monitoring — 모니터링 설정·스모크
#   restore    — 복원 왕복·Restore·Backup
#   web        — web 잡 전체
#   mobile     — mobile 잡 전체
#   smoke      — smoke 잡의 가드 테스트·이미지 빌드·배포 스모크
# api·monitoring·restore 는 목록의 경로가 바뀌면 켠다. web·mobile·smoke 는 거꾸로 센다. 건너뛸 목록에 없는
# 경로가 하나라도 바뀌면 켠다. 그래서 어느 목록에도 없는 경로(루트 설정·lockfile·packages/·.github/·새 최상위
# 폴더)는 셋을 다 켠다. case 는 처음 맞는 줄에서 멈추므로 다른 앱의 파일을 읽는 예외를 건너뛸 목록보다 먼저 둔다.
# dev 로 가는 PR 만 거른다. main 으로 가는 PR·매일 schedule·수동 실행은 전부 켠다.
# pull_request 의 체크아웃은 base 위의 merge commit 이라 HEAD^1 이 base 다(checkout fetch-depth: 2 필요).
set -euo pipefail

if [ "$EVENT" != pull_request ] || [ "$BASE_REF" = main ]; then
  echo "전체 실행 ($EVENT → ${BASE_REF:-없음})"
  printf 'api=true\nmonitoring=true\nrestore=true\nweb=true\nmobile=true\nsmoke=true\n' >> "$GITHUB_OUTPUT"
  exit 0
fi

# 옮긴 파일은 옛 경로·새 경로를 둘 다 센다(--no-renames). 한글 경로는 따옴표 없이 그대로 받는다(core.quotePath=false).
files="$(git -c core.quotePath=false diff --name-only --no-renames HEAD^1 HEAD)"
printf '%s\n' "$files"
api=false; monitoring=false; restore=false; web=false; mobile=false; smoke=false
while IFS= read -r f; do
  # 바뀐 파일이 없으면 read 가 빈 줄 하나를 준다. 빈 줄은 아래 * 에 걸려 잡을 켜므로 거른다.
  [ -n "$f" ] || continue
  case "$f" in
    .github/workflows/ci.yml|.github/scripts/ci-changes.sh|.github/actions/*) api=true; monitoring=true; restore=true ;;
    # ReadingExampleEnglishDraftTest 가 앱의 예시 대본을 읽는다.
    apps/api/*|apps/mobile/lib/reading/sample.ts) api=true ;;
  esac
  case "$f" in
    deploy/monitoring/*|deploy/home/compose.yml|deploy/home/deploy.sh) monitoring=true ;;
  esac
  case "$f" in
    deploy/home/*|apps/api/src/main/resources/db/migration/*|apps/api/src/test/resources/schema-fingerprint.sql) restore=true ;;
  esac
  # 어느 잡도 읽지 않는 문서·에이전트 설정. 세 .md 는 루트에 있는 것만이다.
  case "$f" in
    docs/*|.claude/*|.codex/*|.mcp.json|CLAUDE.md|AGENTS.md|README.md) continue ;;
  esac
  case "$f" in
    # apps/web/tests/practice-http-contract.test.mjs 가 읽는다.
    apps/api/spec/*) web=true ;;
    # apps/web/src/features/admissions 가 빌드 때 notices.json 을 읽는다.
    apps/api/src/main/resources/admissions/*) web=true ;;
    # apps/web/tests/app-store-links.test.mjs 가 읽는다.
    apps/mobile/app.json|apps/mobile/eas.json) web=true ;;
    # apps/web/tests/practice-contract-regression.test.mjs 가 금지 문구를 찾으려고 읽는다.
    apps/mobile/app/upload.tsx|apps/mobile/app/coach.tsx) web=true ;;
    apps/api/*|apps/mobile/*|deploy/*) ;;
    *) web=true ;;
  esac
  case "$f" in
    # apps/mobile/tests/helpers/practice-api.mjs·api-upload-task.mjs 가 읽는다.
    apps/api/spec/*) mobile=true ;;
    apps/api/*|apps/web/*|deploy/*) ;;
    *) mobile=true ;;
  esac
  # smoke 는 apps/api 로 api 이미지를, 루트 컨텍스트(apps/web/Dockerfile·.dockerignore)로 web 이미지를 굽고
  # deploy/guard-test.sh·deploy/home/* 를 돌린다. apps/mobile·deploy/monitoring 은 읽지 않는다.
  case "$f" in
    apps/mobile/*|deploy/monitoring/*) ;;
    *) smoke=true ;;
  esac
done <<< "$files"
echo "api=$api monitoring=$monitoring restore=$restore web=$web mobile=$mobile smoke=$smoke"
printf 'api=%s\nmonitoring=%s\nrestore=%s\nweb=%s\nmobile=%s\nsmoke=%s\n' \
  "$api" "$monitoring" "$restore" "$web" "$mobile" "$smoke" >> "$GITHUB_OUTPUT"
