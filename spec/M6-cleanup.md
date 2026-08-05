# M6 — 정리

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M6 사이클에만 적용된다.**

> **비가역 지점.** 여기서 `apps/api`가 사라지면 M5의 초 단위 롤백 경로가 없어진다. 운영이 안정된 것을 확인한 뒤 시작한다.

## 목적

파이썬을 제거하고 저장소를 Java 단일 백엔드 상태로 정리한다.

## 산출물

### A. 디렉토리 정리

1. `apps/api` 삭제
2. `apps/api-java` → `apps/api`로 rename
3. 배포 스크립트의 경로가 그대로 동작하는지 확인 (`upload-api.sh`가 `-C apps api`를 쓴다)

**rename 후 반드시 재배포해 동작을 확인한다.** 경로가 바뀐 상태로 다음 배포까지 방치하면 그때 깨진다.

### B. 하네스 폐기

`tools/contract-harness/` 삭제. 비교 대상이 사라지므로 유지할 수 없다.

**대신 하네스가 검증하던 것 중 남길 가치가 있는 것을 Java 테스트로 옮긴다**:
- 오류 계약 40종 표 → Java 통합 테스트
- 응답 형상 매트릭스 → springdoc 출력 검증
- 멱등 전이표 → 통합 테스트

이 이관 없이 하네스만 지우면 계약 회귀를 잡을 장치가 사라진다.

### C. 문서 갱신

| 파일 | 내용 |
|---|---|
| `/CLAUDE.md` | 스택 설명(uv 파이썬 → Gradle Java), 실행·검증 명령, 커밋 스코프 |
| `apps/api/CLAUDE.md` | 전면 재작성 — uv/pytest/alembic → Gradle/JUnit/Flyway. **"가짜 세션이라 SQL이 검증되지 않는다"는 경고는 Testcontainers 기준으로 갱신** |
| `apps/api/API.md` | **드리프트를 이번에 바로잡는다** (`GET /v2/reports` 형상, 누락된 `/v2/me`·`/v2/community/*`·`/v2/admissions*`) |
| `docs/DEPLOY-VPC.md` | jar 배포, JVM 설정, 마이그레이션 절차 |
| `docs/DEPLOY-DEV.md` | 인스턴스 스펙 변경, 프로세스 구성 |
| `deploy/bootstrap-dev.sh` | 새 서버 준비 시 Java 설치, uv 제거 |

### D. CI

`.github/workflows/ci.yml`:
- `api (pytest · DB 통합)` 잡 제거
- `api (Gradle · Testcontainers)` 잡 추가. Postgres 서비스는 기존 설정(`ci.yml:69-80`)을 재사용하거나 Testcontainers에 맡긴다
- **잡 이름이 곧 required status check의 context다.** 이름을 바꾸면 ruleset의 required check가 어긋나 머지가 막히거나 게이트가 무력화된다 — ruleset도 함께 갱신한다

`.github/workflows/deploy.yml`:
- `be` 잡의 이름 `back svc (FastAPI)` → Spring Boot로
- `uv sync` 관련 스텝 제거

### E. 잔여 정리

- `pnpm-workspace.yaml`·루트 설정에서 파이썬 관련 항목 확인
- `.gitignore`에서 `.venv`, `__pycache__`, `.pytest_cache`, `.ruff_cache` 제거 여부 판단
- `uv.lock`, `pyproject.toml` 삭제

## 완료 기준 체크리스트

- [ ] `apps/api`가 Java 프로젝트다. 파이썬 파일 0개 (`find apps -name "*.py" | wc -l` → 0)
- [ ] rename 후 **재배포해 dev에서 동작 확인**
- [ ] 하네스가 검증하던 계약 항목이 Java 테스트로 이관됨 (오류 40종·응답 형상·멱등 전이)
- [ ] 하네스 삭제
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과
- [ ] `./gradlew build test` 통과
- [ ] CI 두 잡이 초록. **ruleset의 required check 이름이 새 잡 이름과 일치**
- [ ] 문서 6종 갱신. `API.md` 드리프트 해소
- [ ] `uv.lock`·`pyproject.toml` 삭제
- [ ] 배포 워크플로가 jar 기준으로 동작 (dev 실배포로 확인)

## 하지 말 것

1. **운영이 안정되기 전에 시작하지 않는다.** M5 관찰 기간이 끝나야 한다
2. 하네스 항목을 Java 테스트로 옮기기 **전에** 하네스를 지우지 않는다
3. CI 잡 이름을 바꾸면서 ruleset을 잊지 않는다
4. 스코프 밖 리팩터링 일체

## 이후 (스코프 밖)

- `DeleteObject` 권한 누락 — 워커 sweep이 조용히 실패 중 (`docs/archive/SPEC-SOMA-296-s3-instance-role.md` 5장)
- `ListBucket` 누락으로 `uploads.py:132`의 409 경로가 도달 불가
- `admin_sessions` presign TTL(3600초)과 임시 자격증명 만료의 어긋남
- 공유 IAM 키 은퇴 잔여 절차
