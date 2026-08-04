# apps/api 지침

## 적용 범위·스택

acting-api 백엔드. uv 파이썬 모노레포 — `acting-api`(FastAPI 게이트웨이)가 `acting-summary`·`acting-agent`·`acting-report`를 in-process로 마운트합니다 (별도 HTTP 서비스 아님). API 계약은 [API.md](API.md), 설계 결정은 [docs/design-decisions.md](docs/design-decisions.md).

## 명령어 (이 디렉토리 기준)

- 의존성: `uv sync --frozen --no-dev --package acting-api`
- 로컬 실행: `DEVELOPMENT_AUTH_PROVIDER=1 uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000`
- 마이그레이션: `cd acting-api && set -a; source .env; set +a && uv run alembic upgrade head`
  (alembic은 `.env`를 스스로 읽지 않으므로 셸로 내보내야 합니다)
- 테스트: `uv run --package acting-api pytest`
- **Postgres 통합 테스트(중요)**: `RUN_DB_TESTS=1 TEST_DATABASE_URL="postgresql://<user>@localhost:5432/acting_local" uv run --package acting-api pytest acting-api/tests/test_db_store.py`
  - `RUN_DB_TESTS=1` 없이 돌리면 `test_db_store.py`가 **통째로 skip**됩니다. 기본 `pytest`가 통과해도 SQL이 실제로 검증된 게 아닙니다.
  - 다른 테스트는 가짜 Session이 statement를 저장만 하고 실행하지 않습니다. **Postgres가 SQL 자체를 거부하는 종류의 회귀(잘못된 FROM 앵커, 중복 JOIN 등)는 이 통합 테스트에서만 잡힙니다.**
  - fixture가 `acting_test_<uuid>` 스키마를 만들었다 지우므로 대상 DB의 기존 데이터에는 영향이 없습니다.
  - ORM 쿼리를 손댔다면 커밋 전에 반드시 이 명령을 돌리세요.

## .env (필수, 위치 고정)

`acting-api/.env` — config.py가 이 경로를 하드코딩으로 읽습니다. 키: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `DEVELOPMENT_AUTH_PROVIDER`(로컬 development 로그인 opt-in), `GOOGLE_OAUTH_CLIENT_ID`(선택 override), S3 설정(`S3_BUCKET`/`AWS_REGION` — 함께 설정하거나 생략, 없으면 업로드 503), 선택 자격증명(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — 반드시 한 쌍, `AWS_SESSION_TOKEN`은 임시 자격증명일 때 추가. 미설정 시 boto3 기본 체인이 instance role 등을 탐색), `STATIC_DIR`(선택 — 웹 정적 빌드 서빙, 지정 시 디렉토리가 존재해야 기동).

## 계약 변경 절차 (한 PR로)

1. 라우터/스키마 수정
2. 스펙 재생성: `uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"`
3. 스펙(`openapi.json`)이 응답 계약의 소스. `API.md`는 사람용 설명·응답 예시 문서로 함께 유지
4. 웹 타입 재생성: `pnpm --filter web generate:v2-schema` + 프론트 수정

## 주의

- refresh 토큰은 회전형 — 소진된 토큰 재사용 시 해당 유저 전 세션이 무효화됩니다 (의도된 동작).
- S3 presign은 리전 엔드포인트 고정 (`storage.py`) — 글로벌 엔드포인트는 신규 버킷에 307을 반환합니다.
- 404는 "없음"과 "남의 리소스"를 구분하지 않습니다 (존재 노출 방지).
- 오류 형식은 FastAPI 표준 `{"detail": ...}` 유지.
