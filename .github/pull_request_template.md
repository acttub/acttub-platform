<!-- 제목은 `SOMA-123 <한국어 요약>` 형식으로 적어주세요(docs/BRANCHING-STRATEGY.md 「PR과 Jira」). 키가 있어야 Jira 이슈에 연결됩니다. -->
<!-- 릴리스 PR(`dev`·`release/*` → `main`)은 이 템플릿이 아닙니다. 주소에 `?template=release.md`를 붙여 열면
     릴리스 전용 템플릿이 붙습니다. `dev`에서 열 때는 아래 링크를 씁니다.
     https://github.com/acttub/acttub-platform/compare/main...dev?template=release.md -->

## 변경 내용

<!-- 무엇을 왜 바꿨는지 한두 문단으로. -->

## 검증

<!-- 로컬에서 같은 범위를 돌린 CI 잡에 체크합니다. 잡마다 돌리는 명령과 순서는 .github/workflows/ci.yml 이 정본입니다.
     해당 없는 줄은 지웁니다. -->

- [ ] `web` 잡
- [ ] `api` 잡
- [ ] `mobile` 잡
- [ ] API 계약을 바꿨다면: apps/api/CONTRACT.md 「계약 변경 절차」의 완료 기준

## 참고

<!-- 리뷰어가 알아야 할 배경, 후속 작업, 의도적으로 남긴 것 등. 없으면 지웁니다. -->
