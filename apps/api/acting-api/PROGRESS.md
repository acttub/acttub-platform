# 진행 상황 (acting-api)

## 현재 상태 (2026-07-17)

플랫폼 v2 마이그레이션 5단계 구현이 완료된 상태다. 단일 FastAPI 프로세스가 인증,
약관, S3 업로드, 연습 세션, 비동기 분석, 코칭, 리포트를 제공하고 단일 PostgreSQL
스키마를 사용한다.

- 인증은 HS256 access/refresh JWT와 Google OIDC를 사용한다.
- 보호된 v2 API는 토큰 사용자 기준 60회/분 고정 윈도우 제한을 공유한다.
- v1 HTTP 엔드포인트와 X-API-Key 미들웨어는 제거됐다.
- `api_keys` 테이블·CLI는 사용처가 없어 제거했다 (2026-07-18). 어드민 인증이 필요해지면 새로 설계한다.
- 분석 워커는 S3 영상을 1MiB 청크로 임시 파일에 저장하고 파일 경로로 Gemini에
  전송한다. 기본 동시 분석 수는 1이다.
- 워커의 첫 번째 스레드가 기본 60초 간격으로 만료 upload intent와 최대 시도 횟수
  초과 operation을 스윕한다.

## 실행과 검증

```bash
uv sync
DATABASE_URL=postgresql://localhost/acting uv run alembic -c acting-api/alembic.ini upgrade head
UV_CACHE_DIR=/tmp/acting-api-uv-cache uv run --no-sync pytest
RUN_DB_TESTS=1 TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/acting_test \
  UV_CACHE_DIR=/tmp/acting-api-uv-cache uv run --no-sync pytest
```

필수 런타임 환경 변수는 `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`다. S3를
사용할 때는 `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
네 값을 함께 설정한다.

## 운영 전 남은 항목

- 제한 없는 네트워크 환경에서 PostgreSQL 통합 테스트를 실행한다.
- Google 외 Apple·Kakao 로그인을 출시 일정에 맞춰 추가한다.
- 실제 약관을 법률 검토 후 새 버전으로 게시한다.
- 실사용자 유입 전에 사용자별 일일 분석 상한을 결정한다.
- EC2 상시 가동에서는 self-ping이 필요 없으므로 keepalive 제거 여부를 별도로 결정한다.
  현재 코드는 `KEEP_ALIVE_URL`이 있을 때만 동작하는 opt-in 상태로 유지한다.
