# Sentry → Slack 중계

Sentry 무료(Developer) 플랜은 Slack 연동을 막는다("Requires Team Plan or above", 2026-08-22 체험 종료 뒤).
무료 플랜에서도 알림 규칙 액션으로 쓸 수 있는 internal integration `acttub-slack-relay`가 이 Cloudflare Worker로 알림을 보내고,
Worker가 Slack `#sentry` 메시지로 바꿔 넘긴다. 홈서버가 멈춰도 다운 알림이 와야 하므로 홈서버가 아니라 Cloudflare에서 돈다.
Webhooks (Legacy)는 새 Alerts 화면의 액션 선택지에 없어 쓰지 않는다.

- 메시지 첫 줄의 `[운영]`·`[dev]`는 Sentry 이벤트의 `environment`다. 제목·위치·Sentry 링크만 보내고 이벤트 본문은 보내지 않는다.
- 요청은 URL 경로(`/<RELAY_TOKEN>`)와 `Sentry-Hook-Signature`(integration client secret의 HMAC)가 모두 맞아야 받는다.
- 알림 규칙 액션(`Sentry-Hook-Resource: event_alert`)만 Slack에 넘긴다.
- Slack webhook은 Slack 앱 `acttub-monitoring`의 `#sentry` webhook이다.

## 배포

```sh
cd deploy/monitoring/sentry-slack
node --test worker.test.mjs
npx wrangler@4.151.2 secret put SLACK_WEBHOOK_URL
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
- Monitors > Alerts(세 규칙 모두 두 프로젝트에 연결, 액션 "Send a notification via acttub-slack-relay"):

  | 규칙 | 조건 | 환경 | 이메일 | 간격 |
  |---|---|---|---|---|
  | 운영 기본 | 새 이슈 / 해결한 이슈 재발 / 이슈 escalates | prod | 보냄 | 매번 |
  | 운영 급증 | 이슈 이벤트 1시간 10건 초과 | prod | 보냄 | 24시간 |
  | dev 기본 | 새 이슈 / 해결한 이슈 재발 | dev | 안 보냄 | 매번 |

  우리 코드는 `captureException`(기본 레벨 error)으로만 보내 새 이슈가 모두 high priority라 priority 조건은 두지 않는다.

확인은 규칙 편집 화면의 "Send Test Notification"이 `#sentry`에 오는지로 한다.
토큰이나 client secret을 바꾸면 `secret put` 뒤 integration의 Webhook URL을 함께 바꾼다.
