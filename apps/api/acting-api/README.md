# acting-api

acting-summary / acting-agent / acting-report 세 서비스를 하나로 묶은 통합 게이트웨이 API.
다른 개발자가 HTTP로 호출하는 용도. 모든 요청(문서·헬스체크 제외)에 `X-API-Key` 헤더 필요.

## 실행

```powershell
py -m uv sync
py -m uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

- Gemini 키: `../video-feedback/.env`의 `GEMINI_API_KEY` (기존 세 서비스와 동일)
- 게이트웨이 설정: `acting-api/.env`
  - `API_KEYS` — 유효 API 키 목록(콤마 구분). 미설정 시 모든 요청 503 (fail-closed)
  - `RATE_LIMIT_PER_MIN` — 키별 분당 호출 제한 (기본 10, 초과 시 429)

## 외부 노출 (임시)

```powershell
cloudflared tunnel --url http://localhost:8000
```

출력되는 `https://<random>.trycloudflare.com` URL을 공유. PC가 켜져 있는 동안만 유효, 재실행하면 URL 바뀜.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /summarize | 영상+서브텍스트 → 요약 JSON (multipart: situation, character, subtext, video) |
| POST | /coach/start | 요약 JSON → 코치 대화 시작, session_id 반환 |
| POST | /coach/reply | session_id + text → 코치 다음 발화 |
| POST | /report | user_id + 코치 세션 → 진단 리포트 (히스토리 저장) |
| GET | /report/history/{user_id} | 해당 유저 리포트 히스토리 |
| GET | /health | 상태 확인 (인증 불필요) |
| GET | /docs | Swagger 문서 (인증 불필요) |

## 호출 예시

```bash
# 1) 요약
curl -X POST https://<host>/summarize \
  -H "X-API-Key: <발급받은 키>" \
  -F situation="상황 설명" -F character="인물 설명" -F subtext="서브텍스트" \
  -F video=@scene.mp4

# 2) 코치 대화 시작 (1의 응답 JSON을 summary로)
curl -X POST https://<host>/coach/start \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"summary": { ...1의 응답... }}'

# 3) 대화 이어가기
curl -X POST https://<host>/coach/reply \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"session_id": "<2의 session_id>", "text": "대사가 기억 안 났어요"}'

# 4) 리포트 생성 (세션이 close된 뒤)
curl -X POST https://<host>/report \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"user_id": "u1", "session": { ...코치 세션... }}'
```

## 테스트

```powershell
py -m uv run pytest   # 전부 mock, 실제 Gemini 호출 0
```

## 구조

- 기존 세 프로젝트를 uv path dependency로 참조. 각 프로젝트의 `router.py`(APIRouter)를 게이트웨이가 include — 세 프로젝트 단독 실행도 그대로 가능.
- genai 클라이언트 1개를 세 라우터에 공유 주입 (같은 GEMINI_API_KEY).
- 인증·rate limit은 게이트웨이 미들웨어에서 처리 (`src/acting_api/app.py`).
