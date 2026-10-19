# Sentry 운영 오류 자동 수정

Mac mini(`insung-macmini`)의 launchd가 15분마다 `poll.mjs`를 돌린다. Sentry에서 운영(`environment:prod`)의
새 이슈와 재발 이슈를 골라, 이슈마다 깨끗한 worktree(`origin/dev`)에서 `claude -p`에 `prompt.md`를 맡긴다.
Claude는 코드로 고칠 문제면 Jira 버그 이슈를 만들고 `dev`로 draft PR을 연다. 아니면 아무것도 만들지 않는다.
결과는 Slack `#sentry`에 `[자동 수정]`으로 올라온다. 로컬 Claude Code 구독으로 돌아 API 비용이 없다.

- **개수 상한:** 24시간에 3번, 이벤트가 많은 이슈부터. 새 이슈는 한 번, 재발은 7일에 한 번. Jira 이슈를 에이전트가 만드는 예외는 [ADR-022 개정](../../../docs/ADR.md)이다.
- **넘기는 데이터:** 이슈 요약·예외·우리 코드 프레임·일부 태그만(`summarize`). 요청·사용자·breadcrumb은 넘기지 않는다.
- **Claude 권한:** 읽기·편집, `git`, `./gradlew`, `pnpm`, `gh pr create|view`, Jira 이슈 생성·조회만(`TOOLS`). 머지·배포 권한은 없고 `main`·`dev`는 ruleset이 직접 push를 막는다.
- **상태:** `~/.local/state/acttub-sentry-autofix/`의 `state.json`(처리한 이슈), `ctx/`(넘긴 요약과 Claude 출력), `run.log`.

## 설치 (Mac mini)

필요한 비밀(권한 600): `~/.config/acttub/sentry-read-token`(Sentry personal token, Project·Issue & Event·Organization 읽기),
`~/.config/acttub/sentry-slack-webhook`(Slack 앱 `acttub-monitoring`의 `#sentry` webhook). `claude`·`gh`가 로그인돼 있고
Atlassian MCP(`atlassian`)가 연결돼 있어야 한다.

```sh
git clone https://github.com/acttub/acttub-platform.git ~/acttub-autofix/repo
mkdir -p ~/acttub-autofix/bin ~/.local/state/acttub-sentry-autofix
cp poll.mjs prompt.md ~/acttub-autofix/bin/
node ~/acttub-autofix/bin/poll.mjs --dry-run   # 고를 이슈만 출력
cp com.user.acttub-sentry-autofix.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.acttub-sentry-autofix.plist
```

스크립트를 고치면 `bin/`에 다시 복사한다. 멈출 때는 `launchctl bootout gui/$(id -u)/com.user.acttub-sentry-autofix`.
테스트는 `node --test deploy/monitoring/sentry-autofix/poll.test.mjs`.
