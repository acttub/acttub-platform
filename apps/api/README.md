# acting-api-deploy

연기 피드백 플랫폼 모노레포. 루트 `pyproject.toml`이 uv workspace를 구성하고, `acting-api`가 계정·업로드·분석·코칭·리포트를 단일 FastAPI 앱으로 제공합니다 (acting-summary·acting_agent·acting-report는 in-process 임베드).

- API 계약: [API.md](API.md) · 기계용 스펙: [spec/openapi.json](spec/openapi.json) (재생성: `uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"`)
- 설계 결정 기록: [docs/design-decisions.md](docs/design-decisions.md) · 시각화: [spec/api-spec.html](spec/api-spec.html)
- DB 스키마의 진실: `acting-api/src/acting_api/db/models.py` + `acting-api/alembic/versions/0001_initial_schema.py`
- 배포 대상: EC2 (기존 Render 설정 `render.yaml`은 이전 확정 시 정리 예정)
- 환경 변수 전체 목록: [API.md의 환경 변수 절](API.md#환경-변수) — 필수는 `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`

```bash
uv sync

# 스키마 적용 (빈 DB → 13테이블)
DATABASE_URL=postgresql://localhost/acting uv run alembic -c acting-api/alembic.ini upgrade head

# 서버 실행 (acting-api/.env를 읽음)
uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000

# 테스트 (DB 통합 테스트는 opt-in)
uv run pytest
RUN_DB_TESTS=1 TEST_DATABASE_URL=postgresql://localhost/acting_test uv run pytest
```
