# 브랜치 정리 기록 (2026-08-07)

`dev` 기준으로 저장소를 정리하면서 지운 브랜치와 stash 목록입니다. 커밋은 SHA로 남아 있으니
`git checkout <SHA>` 또는 `git branch <이름> <SHA>`로 되살릴 수 있습니다(원격 GC 전까지).

## 1. dev에 머지 완료 — 태그 없이 삭제

원격·로컬 모두 지웠습니다. 내용은 전부 `dev` 히스토리 안에 있습니다.

| 브랜치 | SHA | 마지막 커밋 |
| --- | --- | --- |
| `chore/SOMA-254-agent-skills-setup` | `a64384c` | 2026-08-07 |
| `chore/SOMA-292-dev-cicd` | `d975d5f` | 2026-08-04 |
| `chore/SOMA-295-ci-build-server` | `f0c244c` | 2026-08-04 |
| `chore/SOMA-297-actions-version-bump` | `50bf79f` | 2026-08-04 |
| `chore/SOMA-289-gitignore-playwright` (로컬 전용) | `78bfaf6` | 2026-08-04 |
| `feat/SOMA-287-springboot-migration` | `77f4463` | 2026-08-06 |
| `feat/SOMA-302-prompt-turn-budget` | `db34f74` | 2026-08-06 |
| `feat/SOMA-302-so-ai-port` | `6102ef8` | 2026-08-06 |
| `feat/SOMA-304-coach-resume` | `d2131a6` | 2026-08-06 |
| `feat/admissions` | `e40d912` | 2026-08-01 |
| `feat/exit-review-back-any` | `48eb2d8` | 2026-08-01 |
| `feat/exit-review-modal` | `d71dace` | 2026-08-01 |
| `feat/mobile-delete-fix-and-onboarding-ui` | `ab98576` | 2026-07-28 |
| `feat/mobile-feedback-fixes` | `e3f8d19` | 2026-08-04 |
| `fix/SOMA-287-m1-preflight` | `b80a38b` | 2026-08-06 |
| `fix/SOMA-308-note-open-button` | `a211b5b` | 2026-08-06 |
| `fix/ga-keep-campaign-params` | `73c2f21` | 2026-07-30 |
| `fix/share-card-origin` (로컬 전용, dev와 동일 커밋) | `07f9dae` | 2026-08-07 |
| `refactor/SOMA-298-drop-static-export` | `e7ceb49` | 2026-08-04 |
| `ci/SOMA-255-deploy-notify-main-auto` (정리 중 PR #103 머지, GitHub이 자동 삭제) | `a8fce2a` | 2026-08-07 |

## 2. dev 미머지 — `archive/*` 태그로 보존 후 삭제

태그는 원격에도 올라가 있어 영구 보존됩니다. `git checkout <태그>`로 바로 꺼내 쓸 수 있습니다.

| 원래 브랜치 | 보존 태그 | SHA | 마지막 커밋 |
| --- | --- | --- | --- |
| `backup/post-pr-commits-20260716` | `archive/backup-post-pr-commits-20260716` | `0de08cd` | 2026-07-16 |
| `checkpoint/pre-ai-integration-20260711` | `archive/checkpoint-pre-ai-integration-20260711` | `908aa5e` | 2026-07-11 |
| `feature/ai-pipeline-integration-20260711` | `archive/feature-ai-pipeline-integration-20260711` | `267d4fd` | 2026-07-11 |
| `feat/web-uiux-fixes` | `archive/feat-web-uiux-fixes` | `4bf9483` | 2026-07-24 |

## 3. 남긴 브랜치

- `dev` `main` — 환경 브랜치
- `feat/SOMA-287-m1-contract-harness` — dev 미머지, 작업 중
- `feat/admissions-expand` (원격) — dev 미머지, 2026-08-07 갱신
- `feat/admin-stats-windows-and-team-exclusion` (원격) — 정리 중 새로 올라온 작업 브랜치

## 4. 삭제한 stash

전부 GitHub Desktop이 자동 생성한 것으로, supabase 시절이나 지금은 없는 경로(`scripts/ai_pipeline_e2e/`,
`supabase/`) 기준이라 현재 코드베이스에 적용되지 않습니다. 패치는 삭제 전 로컬 스크래치패드에 덤프했고,
stash 커밋 SHA로도 접근할 수 있습니다(GC 전까지).

| stash | SHA | 내용 |
| --- | --- | --- |
| `stash@{0}` | `cc6e8c5` | `SPEC.md` 옛 버전 변경(89+/91-) |
| `stash@{1}` | `9fd33bb` | `docs/ACTTUB_DB_SCHEMA_V2.html` 신규 |
| `stash@{2}` | `71584ae` | `docs/acttub-db-schema-for-new-acting-api.html`, `supabase/.temp/` |
| `stash@{3}` | `c9778dc` | `docs/PR_1_REVIEW.md` 등 문서 초안 |
| `stash@{4}` | `35d1cf3` | `scripts/ai_pipeline_e2e/` 테스트 21개 파일 |
