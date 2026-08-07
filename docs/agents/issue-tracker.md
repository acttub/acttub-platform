# 이슈 트래커: Jira (프로젝트 `SOMA`)

이 레포의 이슈·스펙 정본은 **Jira 프로젝트 `SOMA`** 입니다. GitHub Issues는 정본이 아닙니다.

## 접근 수단

**Atlassian 공식 리모트 MCP 서버**(`atlassian`, HTTP, OAuth 2.1)로 Jira를 직접 읽고 씁니다.
로컬 CLI는 쓰지 않습니다.

- 등록: `claude mcp add --scope user --transport http atlassian https://mcp.atlassian.com/v1/mcp/authv2`
- 인증: 세션에서 `/mcp` → `atlassian` → 브라우저 OAuth. 각자 한 번씩 해야 합니다.
- 확인: `claude mcp get atlassian` 이 `✔ Connected` 여야 합니다.

MCP 도구는 필요할 때 `ToolSearch`로 스키마를 불러와 씁니다.
**연결이 안 된 상태라면 티켓 번호나 본문을 추측하지 마세요.** 인증부터 요청하고,
그때까지는 티켓 초안을 대화에 출력하는 방식으로 대체합니다.

## 스킬이 "이슈 트래커에 발행하라"고 할 때

`SOMA` 프로젝트에 Jira 이슈를 만듭니다.

- 제목은 한국어 한 줄. 커밋처럼 `~한다` 평서형일 필요는 없고, 무엇이 문제인지 드러나게 씁니다.
- 본문 구조: **배경 / 원하는 상태 / 완료 조건(체크리스트) / 참고(파일 경로·ADR 번호)**
- 여러 건이면 우선순위 순으로 만들고, 만든 뒤 키 목록(`SOMA-123`…)을 대화에 정리해 보고합니다.
- 이슈 타입·담당자·스프린트는 **비워둡니다.** 사람이 백로그 정리 때 채웁니다.

## 스킬이 "해당 티켓을 가져오라"고 할 때

1. 현재 브랜치명·PR 제목에서 키를 추출합니다 — `git branch --show-current`, `gh pr view --json title`.
   브랜치 규칙이 `feat/SOMA-123-<slug>`이라 대개 여기서 나옵니다.
2. 그 키로 Jira 이슈를 조회합니다. 코멘트까지 읽어야 맥락이 맞는 경우가 많으니 같이 가져옵니다.
3. 키를 못 찾으면 사용자에게 묻습니다. 비슷한 제목으로 검색해 **추정한 티켓을 정답처럼 쓰지 마세요.**

## 쓰기 작업의 경계

읽기는 자유롭게, 쓰기는 아래 선을 지킵니다.

- **상태 전이(`In Progress` / `검토 중` / `Done`)를 손대지 않습니다.** GitHub 연동이 브랜치 생성·PR
  오픈·머지에 맞춰 자동으로 굴립니다. 에이전트가 겹쳐서 바꾸면 자동화와 어긋납니다.
  `보류 중`도 사람 전용입니다.
- **이슈 삭제 금지.** 잘못 만들었으면 사람에게 알리고 판단을 받습니다.
- **기존 본문 덮어쓰기 전 확인.** 남의 티켓 설명을 통째로 갈아엎지 말고, 추가 정보는 코멘트로 답니다.
- 한 번에 5건 넘게 만들 상황이면 만들기 전에 목록을 보여주고 승인을 받습니다.

## 브랜치·PR 규칙 (Jira 자동화가 여기에 걸려 있음)

`CLAUDE.md`의 "이슈 추적 (Jira 연동)" 절이 정본이며, 요약하면:

- 브랜치명에 **대문자** 키를 포함: `feat/SOMA-123-exit-review-modal` (타입 뒤, 설명 앞)
- PR 제목: `SOMA-123 <한국어 요약>`
- 커밋 메시지에는 키를 넣지 않습니다(Conventional Commits 그대로).

키가 빠진 브랜치는 Jira 연결이 끊깁니다. 브랜치를 새로 만들 때는 키를 먼저 확인하고,
모르면 만들기 전에 물어봅니다.

## GitHub Issues의 위치

GitHub Issues는 **외부 제보용 인박스**입니다. 정식 작업은 Jira로 옮겨 진행하므로,
에이전트는 GitHub Issue를 참고 자료로 읽을 수는 있어도(`gh issue view <n> --comments`)
거기에 작업 계획을 쌓지 않습니다. 제보가 진짜 작업이 되면 Jira 티켓으로 옮기고,
GitHub Issue 쪽에는 옮긴 곳을 코멘트로 남깁니다.

## PR을 요청 접수 창구로 쓰는가

**아니오.** 외부 PR은 트리아지 큐에 넣지 않습니다.

## Wayfinding 운영

`/wayfinder`의 map/child 구조를 Jira로 표현합니다.

- **map**: Epic 하나. Notes / Decisions-so-far / Fog를 본문에 둡니다.
- **child ticket**: 그 Epic 아래 하위 작업. 라벨로 종류를 표시합니다
  (`wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`).
- **blocking**: Jira 이슈 링크의 `blocks` / `is blocked by` 관계를 씁니다.
  블로커가 전부 닫히면 풀린 것으로 봅니다.
- **claim**: 담당자 지정은 사람이 합니다. 에이전트는 "다음에 뭘 잡으면 되는지"만 제시합니다.
- **resolve**: 답을 코멘트로 남기고, Epic 본문의 Decisions-so-far에 한 줄 추가합니다.
  티켓을 닫는 것은 사람이 합니다(상태 전이 금지 규칙과 같은 이유).
