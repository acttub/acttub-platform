# acting-agent

acting-summary가 만든 요약(SceneSummary JSON)을 입력으로 받아,
배우가 '의도한 것'과 '실제 보인 것'의 차이를 스스로 말하게 만드는 대화형 코치 에이전트.

## 게이트웨이 통합

`acting-agent`는 별도 HTTP 서비스나 로컬 UI로 실행하지 않는다.
`acting-api` FastAPI 게이트웨이에 in-process로 임베드·마운트되며,
게이트웨이가 Bearer 인증과 리소스 소유권 검증을 포함한 공개 API를 제공한다.

- `POST /v2/coach/start` — `{"summary_id": "<UUID>"}`로 코칭 세션 시작
- `POST /v2/coach/reply` — `{"session_id": "<UUID>", "text": "..."}`로 대화 계속

패키지 내부의 `acting_agent.app:create_app`은 같은 요청·응답 계약을
`/coach/start`와 `/coach/reply`에 노출하며 패키지 수준 계약 테스트에 사용한다.

## 테스트

`apps/api` 디렉토리 기준:

```bash
uv run --package acting-agent pytest acting-agent/tests
```
