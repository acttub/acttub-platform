# acting-agent

acting-summary가 만든 관찰 팩과 배우가 쓴 상황·캐릭터·목적을 입력으로 받아,
배우의 최신 말에서 출발하는 OpenAI 기반 대화형 코치 에이전트.

## 게이트웨이 통합

`acting-agent`는 별도 HTTP 서비스나 로컬 UI로 실행하지 않는다.
`acting-api` FastAPI 게이트웨이에 in-process로 임베드·마운트되며,
게이트웨이가 Bearer 인증과 리소스 소유권 검증을 포함한 공개 API를 제공한다.

- `POST /v2/coach/start` — `{"practice_session_id": "<UUID>"}`로 코치의 첫 발화와 함께 세션 생성
- `POST /v2/coach/reply` — `{"session_id": "<UUID>", "text": "..."}`로 코치 질문에 답하며, complete이면 게이트웨이가 handoff 자동 확인과 리포트 생성을 함께 처리
- `POST /v2/coach/confirm` — 호환용 수동 확인·반박 경로(현재 화면 흐름에서는 사용하지 않음)

게이트웨이의 start/reply 응답은 `session_id`, `message`, `status`, `handoff`, `report`를 노출한다.
start의 `message`에는 코치의 첫 발화가 담기고, 세션도 그 첫 턴을 포함해 저장된다.
분석 막힘에는 coach v2, 표현 막힘에는 coach v3 프롬프트를 사용한다.

패키지 내부의 `acting_agent.app:create_app`은 같은 요청·응답 계약을
`/coach/start`와 `/coach/reply`에 노출하며 패키지 수준 계약 테스트에 사용한다.

## 테스트

`apps/api` 디렉토리 기준:

```bash
uv run --package acting-agent pytest acting-agent/tests
```
