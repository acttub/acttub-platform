# Sentry → Slack 중계

Sentry 무료(Developer) 플랜은 Slack 연동을 막는다("Requires Team Plan or above", 2026-08-22 체험 종료 뒤).
무료 플랜에서도 알림 규칙 액션으로 쓸 수 있는 internal integration `acttub-slack-relay`가 이 Cloudflare Worker로 알림을 보내고,
Worker가 Slack 앱 `acttub-monitoring` 봇(`chat.postMessage`)으로 `#sentry`에 올린다. 홈서버가 멈춰도 다운 알림이 와야 하므로 홈서버가 아니라 Cloudflare에서 돈다.
Webhooks (Legacy)는 새 Alerts 화면의 액션 선택지에 없어 쓰지 않는다.

- 메시지 첫 줄의 `[운영 · 계속 남]`에서 앞은 Sentry 이벤트의 `environment`, 뒤는 알림 규칙 이름에서 환경 단어를 뺀 것(무슨 일인지)이다. 제목·위치·Sentry 링크만 보내고 이벤트 본문은 보내지 않는다.
- 요청은 URL 경로(`/<RELAY_TOKEN>`)와 `Sentry-Hook-Signature`(integration client secret의 HMAC)가 모두 맞아야 받는다.
- 알림 규칙 액션(`Sentry-Hook-Resource: event_alert`)만 Slack에 넘긴다.
- 운영·dev 알림은 KV `ALERTS`에 이슈 ID·환경·규칙 이름·시각·Slack 메시지 위치(channel·ts)만 14일 남긴다. [자동 수정](../sentry-autofix/README.md)이 `GET /<RELAY_TOKEN>/alerts`로 가져가 그 알림에 결과 이모지와 스레드 답글을 단다.
- 봇 토큰 권한은 `chat:write`·`reactions:write`이고, 봇을 `#sentry`에 초대해야 한다. 채널 ID는 `wrangler.toml`의 `SLACK_CHANNEL`.

## 배포

```sh
cd deploy/monitoring/sentry-slack
node --test worker.test.mjs
npx wrangler@4.151.2 kv namespace create ALERTS   # 처음 한 번. 나온 id를 wrangler.toml에 넣는다
npx wrangler@4.151.2 secret put SLACK_BOT_TOKEN   # xoxb-, ~/.config/acttub/sentry-slack-bot-token과 같다
npx wrangler@4.151.2 secret put RELAY_TOKEN
npx wrangler@4.151.2 secret put SENTRY_CLIENT_SECRET
npx wrangler@4.151.2 deploy
```

Sentry 설정 위치:
- Settings > Developer Settings > Custom Integrations > `acttub-slack-relay`: Webhook URL `https://<worker 주소>/<RELAY_TOKEN>`, Alert Action 켬, 구독 없음.
- `acttub-api`·`acttub-web` Settings > Issue Grouping > Fingerprint Rules: 두 환경이 한 프로젝트를 쓰므로 이슈를 환경별로 나눈다.
  이게 없으면 dev에서 먼저 난 에러는 운영에서 "새 이슈"가 아니라 알림이 오지 않는다.
  ```
  tags.environment:"prod" -> {{ default }}, prod
  tags.environment:"dev" -> {{ default }}, dev
  ```
- Monitors > Alerts(모든 규칙을 두 프로젝트에 연결, 액션 "Send a notification via acttub-slack-relay"). 운영은 무슨 일인지가 Slack에 보이도록 경우마다 규칙을 나눈다.
  "간격"은 규칙마다 따로 세므로 "계속 남"이 온 날에도 "다시 남"은 막히지 않는다.

  | 규칙 | 조건 | 환경 | 이메일 | 간격 |
  |---|---|---|---|---|
  | 운영 처음 남 | 새 이슈 | prod | 보냄 | 매번 |
  | 운영 다시 남 | 해결한 이슈 재발 | prod | 보냄 | 매번 |
  | 운영 늘어남 | 보관한 이슈 escalates | prod | 보냄 | 매번 |
  | 운영 계속 남 | 모든 이벤트 + 이슈가 생긴 지 1일 초과 | prod | 안 보냄 | 24시간 |
  | 운영 급증 | 이슈 이벤트 1시간 10건 초과 | prod | 보냄 | 24시간 |
  | dev 기본 | 새 이슈 / 해결한 이슈 재발 | dev | 안 보냄 | 매번 |

  "1일 초과" 필터는 첫날 "처음 남"과 겹치지 않게 한다. 해결 처리 직후(1분 안쪽)에 들어온 이벤트는 Sentry가 재발로 보지 않는다(2026-10-20 시험).
  생긴 지 1일이 넘은 이슈가 재발하면 "다시 남"과 "계속 남"이 같이 올 수 있다. 보관은 "늘어날 때까지 보관(until escalating)"만 쓴다.

  우리 코드는 `captureException`(기본 레벨 error)으로만 보내 새 이슈가 모두 high priority라 priority 조건은 두지 않는다.

확인은 규칙 편집 화면의 "Send Test Notification"이 `#sentry`에 오는지로 한다.
토큰이나 client secret을 바꾸면 `secret put` 뒤 integration의 Webhook URL을 함께 바꾼다.
