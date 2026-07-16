# acting-api-deploy

Render 배포용 모노레포 스냅샷. 루트 `pyproject.toml`이 uv workspace를 구성하고, `acting-api`가 summary/coach/report 라우터를 한 프로세스에 마운트합니다.

- 원본: acttub/acttub-ai-summary, acttub/acttub-ai-report, acttub/acttub-ai-agent + 로컬 acting-api
- 갱신: 로컬에서 `.\sync_deploy.ps1` 실행 → diff 확인 → commit/push → Render 자동 재배포
- 배포 설정: `render.yaml` (루트 workspace sync, Alembic upgrade, uvicorn factory)
- 필수 환경변수: `DATABASE_URL`, `GEMINI_API_KEY`
- 선택 환경변수: `GEMINI_MODEL`, `COACH_MAX_QUESTIONS`, `KEEP_ALIVE_URL`, `KEEP_ALIVE_INTERVAL_SEC`

```bash
uv sync
DATABASE_URL=postgresql://localhost/acting uv run alembic -c acting-api/alembic.ini upgrade head
DATABASE_URL=postgresql://localhost/acting uv run python -m acting_api.api_keys issue --label local
DATABASE_URL=postgresql://localhost/acting GEMINI_API_KEY=... uv run uvicorn acting_api.app:create_app --factory
uv run pytest
```

API 키 평문은 발급 명령에서 한 번만 출력되고 DB에는 SHA-256 해시만 저장됩니다. 전체 API 계약은 [API.md](API.md), 확정 DB 스키마는 [docs/db-schema.md](docs/db-schema.md)를 참고하세요.
