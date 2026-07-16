# acting-api

acting-summary / acting-agent / acting-report 세 서비스를 하나로 묶은 통합 게이트웨이 API.
다른 개발자가 HTTP로 호출하는 용도. 모든 요청(문서·헬스체크 제외)에 `X-API-Key` 헤더 필요.

## 실행

```bash
uv sync
DATABASE_URL=postgresql://localhost/acting uv run alembic -c acting-api/alembic.ini upgrade head
DATABASE_URL=postgresql://localhost/acting GEMINI_API_KEY=... uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

- `DATABASE_URL`과 `GEMINI_API_KEY`는 필수이며, 누락 시 앱이 기동하지 않습니다.
- `postgres://`와 `postgresql://` URL은 SQLAlchemy psycopg3 드라이버 URL로 정규화됩니다.
- API 키는 `api_keys` 테이블에서 SHA-256 해시로 조회하고, 키별 `rate_limit_per_min`을 적용합니다.

## API 키 관리

```bash
uv run python -m acting_api.api_keys issue --label local --rate-limit-per-min 10
uv run python -m acting_api.api_keys list
uv run python -m acting_api.api_keys revoke <api-key-uuid>
```

발급 시 평문은 한 번만 출력됩니다. 세 명령 모두 `DATABASE_URL`이 필요합니다.

## 외부 노출 (임시)

```powershell
cloudflared tunnel --url http://localhost:8000
```

출력되는 `https://<random>.trycloudflare.com` URL을 공유. PC가 켜져 있는 동안만 유효, 재실행하면 URL 바뀜.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /summarize | user_id+영상+서브텍스트 저장 → 요약 JSON과 summary_id |
| POST | /coach/start | summary_id → 저장된 요약으로 코치 대화 시작 |
| POST | /coach/reply | session_id + text → 코치 다음 발화 |
| POST | /report | session_id → 저장된 세션으로 진단 리포트 생성 |
| GET | /report/history/{user_id} | 해당 유저 리포트 히스토리 |
| GET | /health | 상태 확인 (인증 불필요) |
| GET | /docs | Swagger 문서 (인증 불필요) |

## 호출 예시

```bash
# 1) 요약
curl -X POST https://<host>/summarize \
  -H "X-API-Key: <발급받은 키>" \
  -F user_id="u1" -F situation="상황 설명" -F character="인물 설명" -F subtext="서브텍스트" \
  -F video=@scene.mp4

# 2) 코치 대화 시작 (1의 summary_id)
curl -X POST https://<host>/coach/start \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"summary_id": "<summary_id>"}'

# 3) 대화 이어가기
curl -X POST https://<host>/coach/reply \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"session_id": "<2의 session_id>", "text": "대사가 기억 안 났어요"}'

# 4) 리포트 생성 (세션이 close된 뒤)
curl -X POST https://<host>/report \
  -H "X-API-Key: <키>" -H "Content-Type: application/json" \
  -d '{"session_id": "<session_id>"}'
```

## 테스트

```bash
uv run pytest   # DB/Gemini 통합 테스트는 기본 skip
RUN_DB_TESTS=1 TEST_DATABASE_URL=postgresql://... uv run pytest -m db
```

## 구조

- 루트 uv workspace가 네 프로젝트를 관리합니다. 각 하위 프로젝트의 `router.py`를 게이트웨이가 in-process include합니다.
- genai 클라이언트 1개를 세 라우터에 공유 주입 (같은 GEMINI_API_KEY).
- SQLAlchemy 모델 8개·엔진·Alembic·PostgreSQL store는 acting-api에만 두고, 동일 store를 세 라우터에 주입합니다.
- 인증·키별 rate limit은 게이트웨이 미들웨어에서 처리합니다.
