#!/usr/bin/env bash
# ci-changes.sh 의 경로 판정 테스트. 어느 디렉토리에서 실행해도 된다.
#   .github/scripts/ci-changes-test.sh
# 경우마다 임시 git 저장소에 base 커밋과 파일을 바꾼 커밋을 만들고, CI 와 같은 env 로 스크립트를 돌려
# $GITHUB_OUTPUT 에서 true 인 판정을 기대와 맞춘다.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-changes.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ci-changes-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
# 사용자의 git 설정(서명·훅·quotePath 등)이 섞이지 않게 한다.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
failures=0

# put <파일> — 내용은 경로 자체라 파일마다 다르다.
put() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$1" > "$1"; }

# judge <event> <base_ref> <바꾼 파일...> — true 인 판정 이름을 정렬해 한 줄로 찍는다.
# 파일 자리에 "옛경로=>새경로" 를 주면 base 에 옛 경로를 두고 git mv 로 옮긴다.
judge() {
  local event="$1" base="$2"; shift 2
  local repo f
  repo="$(mktemp -d "$WORK/repo.XXXXXX")"
  git -C "$repo" init -q
  for f in "$@"; do
    case "$f" in *'=>'*) put "$repo/${f%%=>*}" ;; esac
  done
  git -C "$repo" add -A
  git -C "$repo" commit -q --allow-empty -m base
  for f in "$@"; do
    case "$f" in
      *'=>'*) mkdir -p "$repo/$(dirname "${f##*=>}")"; git -C "$repo" mv "${f%%=>*}" "${f##*=>}" ;;
      *) put "$repo/$f" ;;
    esac
  done
  git -C "$repo" add -A
  git -C "$repo" commit -q -m change
  (cd "$repo" && EVENT="$event" BASE_REF="$base" GITHUB_OUTPUT="$repo.out" "$SCRIPT" > /dev/null)
  sed -n 's/=true$//p' "$repo.out" | sort | xargs
}

# check <켜질 판정들> <event> <base_ref> <바꾼 파일...>
check() {
  local want got
  want="$(printf '%s\n' $1 | sort | xargs)"; shift
  got="$(judge "$@")"
  if [ "$got" = "$want" ]; then
    printf 'ok    %-40s %s\n' "[$want]" "$*"
  else
    printf 'FAIL  %s\n      기대 [%s] 실제 [%s]\n' "$*" "$want" "$got"
    failures=$((failures + 1))
  fi
}

ALL="api monitoring restore"

# dev 로 가는 PR 만 거른다.
check "$ALL" schedule "" docs/a.md
check "$ALL" workflow_dispatch "" docs/a.md
check "$ALL" pull_request main docs/a.md

# CI 자신을 고치면 전부 돈다.
check "$ALL" pull_request dev .github/workflows/ci.yml
check "$ALL" pull_request dev .github/scripts/ci-changes.sh
check "$ALL" pull_request dev .github/actions/setup-java-gradle/action.yml

check "api" pull_request dev apps/api/src/main/java/A.java
check "" pull_request dev apps/web/src/a.ts
check "" pull_request dev docs/a.md
check "api" pull_request dev apps/web/src/a.ts apps/api/build.gradle.kts

check "monitoring" pull_request dev deploy/monitoring/alloy/config.alloy
check "monitoring restore" pull_request dev deploy/home/compose.yml
check "monitoring restore" pull_request dev deploy/home/deploy.sh
check "restore" pull_request dev deploy/home/backup/run.sh
check "api restore" pull_request dev apps/api/src/main/resources/db/migration/V99__x.sql
check "api restore" pull_request dev apps/api/src/test/resources/schema-fingerprint.sql

# base 커밋이 없으면(체크아웃 fetch-depth 가 1) 건너뛰지 않고 실패한다.
shallow="$(mktemp -d "$WORK/shallow.XXXXXX")"
git -C "$shallow" init -q
put "$shallow/apps/api/A.java"
git -C "$shallow" add -A
git -C "$shallow" commit -q -m only
if (cd "$shallow" && EVENT=pull_request BASE_REF=dev GITHUB_OUTPUT="$shallow.out" "$SCRIPT" > /dev/null 2>&1); then
  printf 'FAIL  base 커밋이 없는데 초록으로 끝났다\n'
  failures=$((failures + 1))
else
  printf 'ok    base 커밋이 없으면 실패한다\n'
fi

if [ "$failures" -ne 0 ]; then
  printf '\n✗ %s 경우가 기대와 다르다\n' "$failures" >&2
  exit 1
fi
printf '\n✔ ci-changes.sh 경로 판정 테스트 통과\n'
