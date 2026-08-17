# apps/api 지침

## 적용 범위·스택

acting-api 백엔드. uv 파이썬 모노레포 — `acting-api`(FastAPI 게이트웨이)가 `acting-summary`·`acting-agent`·`acting-report`를 in-process로 마운트하고(별도 HTTP 서비스 아님), 공용 LLM·검증 유틸은 `acting-llm` 패키지에 있습니다. 워크스페이스 멤버 5개는 `pyproject.toml`이 정본입니다. API 계약은 [API.md](API.md), 설계 결정은 [docs/design-decisions.md](docs/design-decisions.md).

## 명령어 (이 디렉토리 기준)

- 의존성: `uv sync --frozen --all-packages` — 개발·테스트는 이걸 씁니다. `acting-api`가 나머지 패키지를 import하고 pytest는 dev 그룹에 있어, `--no-dev --package acting-api`(배포용 최소 설치)로 깔면 아래 테스트 명령이 돌지 않습니다.
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

`acting-api/.env` — config.py가 이 경로를 하드코딩으로 읽습니다. 키: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, **`OPENAI_API_KEY`**, `DEVELOPMENT_AUTH_PROVIDER`(로컬 development 로그인 opt-in), `GOOGLE_OAUTH_CLIENT_ID`(선택 override), S3 설정(`S3_BUCKET`/`AWS_REGION` — 함께 설정하거나 생략, 없으면 업로드 503), 선택 자격증명(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — 반드시 한 쌍, `AWS_SESSION_TOKEN`은 임시 자격증명일 때 추가. 미설정 시 boto3 기본 체인이 instance role 등을 탐색), `STATIC_DIR`(선택 — 웹 정적 빌드 서빙, 지정 시 디렉토리가 존재해야 기동).

**AI 키가 둘로 갈립니다** — 영상 관찰·음성 전사는 Gemini(`GEMINI_API_KEY`), 코치·리포트는 OpenAI(`OPENAI_API_KEY`)입니다. 모델은 기본값이 있어 생략해도 됩니다(`GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, `OPENAI_CHAT_MODEL`). `OPENAI_TRANSCRIBE_MODEL`은 M5 환경변수 호환 계약 때문에 남아 있지만 FastAPI 전사 경로에서는 쓰지 않습니다.

**`OPENAI_API_KEY`는 없어도 앱이 기동합니다.** `GatewaySettings`가 이 키를 모르고 `openai_client.py`가 호출 시점에 `os.environ`으로 직접 읽기 때문입니다(`S3_BUCKET`이 자격증명 없으면 기동을 막는 것과 다릅니다). 그래서 로그인·업로드·분석까지 다 통과한 뒤 **코치를 시작하는 순간 500**이 납니다. 음성 전사는 기동 필수인 `GEMINI_API_KEY`와 앱의 단일 Gemini 클라이언트를 사용합니다. 전사 호출 자체가 실패하면 분석은 계속되어 대사 없는 세션이 만들어질 수 있지만, 로그에는 `provider=gemini`와 실패 원인이 함께 남습니다. "코치 연결에 실패했어요"를 만나면 `OPENAI_API_KEY`부터 확인하세요.

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
