# Sentry 오류 자동 수정

Mac mini(`insung-macmini`)의 Hermes 예약 작업(`acttub-sentry-autofix`)이 15분마다 `poll.mjs`를 돌린다. Slack `#sentry`에 간 운영·dev 알림을
[Slack 중계 Worker](../sentry-slack/README.md)의 KV에서 가져와, 이슈마다 깨끗한 worktree에서 `claude -p`에 `prompt.md`를 맡긴다.
그래서 자동 수정이 보는 오류는 Slack 알림과 같다. 운영 알림을 먼저 처리한다. 하루 한 번 오는 "운영 계속 남"만 처음 보는 이슈로 줄인다.
Claude는 코드로 고칠 문제면 Jira 버그 이슈를 진행 중 스프린트에 만들어 진행 중으로 옮기고, draft PR을 연 뒤 CI를 기다려 실패하면 두 번까지 고친다(90분 한도). 아니면 아무것도 만들지 않는다.
PR의 기준은 환경별로 다르다(`TARGET`).

| 알림 | 작업 기준 | 브랜치 | PR 대상 |
|---|---|---|---|
| 운영 | `origin/main` | `hotfix/SOMA-<번호>-…` | `main` |
| dev | `origin/dev` | `Fiddich-Dev/soma-<번호>-…` | `dev` |

머지는 사람이 한다. 운영 hotfix는 머지하면 운영에 배포되고, 다음 실행이 머지된 hotfix를 보면 `main` → `dev` 역병합 PR을 열고 Slack에 알린다([Hotfix](../../../docs/BRANCHING-STRATEGY.md#hotfix) 4번). 이미 열린 역병합 PR이 있으면 그것을 쓰고, 충돌은 사람이 푼다.
결과는 Slack `#sentry`에 `[자동 수정]`으로 올라온다. 로컬 Claude Code 구독으로 돌아 API 비용이 없다.
결과는 Slack `#sentry`의 그 알림 메시지에 이모지(⏳ 처리 중, ✅ PR, 🔗 앞 PR이 열려 있음, ⏩ 수정 대상 아님, ❌ 실패)와 스레드 답글로 달린다. 메시지 위치가 없는 옛 알림과 역병합 알림은 채널에 `[자동 수정]`으로 따로 올라온다. 자동 수정 PR은 GitHub 라벨 `sentry-autofix`와 제목 `SOMA-<번호> [자동 수정] …`, Jira 이슈는 라벨 `sentry-autofix`로 구분한다. 로컬 Claude Code 구독으로 돌아 API 비용이 없다.

- **고르는 규칙:** 알림마다 한 번. 같은 이슈에 알림이 여러 번 왔으면 마지막 처리 뒤에 온 것만 한 번 처리한다. 개수 제한 없이 먼저 온 알림부터 하나씩 처리한다. 알림 뒤에 사람이 해결·보관한 이슈는 건너뛴다. "운영 계속 남" 알림은 처리 기록이 없거나, 지난번에 끝내지 못했거나(fail·running), 고친 PR이 `main`(운영)에 들어갔는데도 다시 난 이슈만 처리한다. 건너뛴 이슈, PR이 열려 있거나 닫혔거나 운영 배포 전인 이슈는 Slack 알림으로 둔다. KV는 알림을 14일 남기므로 Mac mini가 그보다 오래 꺼져 있으면 그 알림은 빠진다. 에이전트가 Jira 이슈를 만드는 근거는 [ADR-022](../../../docs/ADR.md) 개정이다.
- **dev에만 고쳐진 오류:** 출시를 기다리는 것으로 보고 건너뛴다. Slack 이유에 "출시 대기"와 그 커밋이 적힌다. 그 수정을 hotfix로 당길지는 사람이 정한다.
- **다시 온 알림:** 앞서 연 PR이 아직 열려 있으면 Claude를 돌리지 않고 Slack에 그 PR만 알린다. 닫혔거나 머지됐으면 앞 Jira 이슈·PR을 새 이슈 배경에 적게 한다. 같은 원인의 열린 PR이 있으면 Claude가 건너뛴다.
- **넘기는 데이터:** 이슈 요약·예외·우리 코드 프레임·일부 태그만(`summarize`). 요청·사용자·breadcrumb은 넘기지 않는다.
- **Claude 권한:** 읽기·편집, `git`, `./gradlew`, `pnpm`, `gh pr create|view|list|checks`, `gh run view`, Jira 이슈 생성·조회·검색·전이·댓글만(`TOOLS`). 머지·배포(`gh workflow run`) 권한은 없고 `main`·`dev`는 ruleset이 직접 push를 막는다.
- **상태:** `~/.local/state/acttub-sentry-autofix/`의 `state.json`(이슈별 마지막 처리 시각과 결과), `ctx/`(넘긴 요약과 Claude 출력), `run.log`, `lock/`(실행 중인 pid. 강제 종료로 남으면 다음 실행이 그 pid가 죽은 것을 보고 푼다).

## 설치 (Mac mini)

필요한 비밀(권한 600): `~/.config/acttub/sentry-read-token`(Sentry personal token, Project·Issue & Event·Organization 읽기),
`~/.config/acttub/sentry-slack-webhook`(Slack 앱 `acttub-monitoring`의 `#sentry` webhook), `~/.config/acttub/sentry-slack-bot-token`(같은 앱의 봇 토큰, [중계](../sentry-slack/README.md)와 같다),
`~/.config/acttub/sentry-relay-alerts-url`(`https://<Worker 주소>/<RELAY_TOKEN>/alerts`). `claude`·`gh`가 로그인돼 있고
Atlassian MCP(`atlassian`)가 연결돼 있어야 한다.
SSH 세션은 로그인 키체인을 못 읽어, 거기서 `claude`를 실행하면 Atlassian이 "인증 필요"로 `~/.claude/mcp-needs-auth-cache.json`에 기록되고
뒤이은 자동 수정도 Atlassian을 건너뛴다. 맥미니 `claude` 확인은 화면이나 launchd에서 한다. launchd는 `~/Documents` 접근 허락이 없어 저장소 클론을 `~/acttub-autofix/repo`에 둔다.

```sh
git clone https://github.com/acttub/acttub-platform.git ~/acttub-autofix/repo
mkdir -p ~/acttub-autofix/bin ~/.local/state/acttub-sentry-autofix
cp poll.mjs prompt.md ~/acttub-autofix/bin/
node ~/acttub-autofix/bin/poll.mjs --dry-run   # 고를 이슈만 출력
cp com.user.acttub-sentry-autofix.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.acttub-sentry-autofix.plist
```

스크립트를 고치면 `bin/`에 다시 복사한다. 지금 Mac mini는 launchd 대신 Hermes 예약 작업으로 돌린다(같은 명령과 환경을 `~/.hermes/scripts/launchd/acttub-sentry-autofix.sh`가 재현한다). 멈출 때는 `hermes cron pause <작업 ID>`(ID는 `hermes cron list`), launchd로 돌릴 때는 `launchctl bootout gui/$(id -u)/com.user.acttub-sentry-autofix`.
테스트는 `node --test deploy/monitoring/sentry-autofix/poll.test.mjs`.
