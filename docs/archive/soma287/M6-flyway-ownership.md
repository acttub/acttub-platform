# M6 — Flyway 정본화 (SOMA-403 3단계)

티켓 3단계와 `spec/M6-cleanup.md` D 절이 요구한 것을 실제로 돌린 결과다. 추정이 아니라
실행 결과만 적었다.

- 실행: `REQUIRE_ALEMBIC_CHECK=1 ./gradlew test` (Testcontainers postgres:18-alpine, JDK 21)
- 판정: **통과** — 클래스 91 · 테스트 419 · 실패 0. 건너뛴 5는 실제 Gemini 키를 요구하는
  spike 뿐이고, 파이썬 대조 테스트는 하나도 건너뛰지 않았다

## 0. 한 줄 결론

**스키마 정본이 Flyway 다.** 배포는 jar 하나만 보내고 마이그레이션은 기동 중에 Flyway 가
적용한다. `V1__baseline.sql` 은 동결이고 변경은 `V2__` 부터다.

| 관문 | 결과 |
|---|---|
| baseline 기록만 있는 DB(dev·운영)가 다음 마이그레이션을 받는다 | ✅ |
| 신규 환경(V1 을 SQL 로 밟은 DB)도 같은 것을 받고 결과 스키마가 같다 | ✅ |
| V1 을 고치면 잡힌다 | ✅ checksum `-1135202796` 을 못박음 |
| 배포에서 alembic 이 사라졌다 | ✅ `be_java` 잡에서 스텝 셋 제거 |

## 1. 무엇을 확인했나 — **아무도 확인한 적 없던 자리**

dev·운영의 `flyway_schema_history` 에는 `<< Flyway Baseline >>` 한 줄뿐이고,
**Flyway 가 그 DB 에서 마이그레이션을 실행한 적이 한 번도 없다.** V1 은 기록만 됐고 V2 는
존재하지 않는다. 3단계는 그 미검증 경로에 스키마 소유권을 통째로 넘기는 일이라, 경로가
실제로 뚫려 있는지가 관문이다.

`FlywayForwardMigrationTest` 가 프로브 마이그레이션(`ALTER TABLE users ADD COLUMN …`)을 두
경로에 모두 통과시킨다. 프로브는 `db/migration` 에 커밋하지 않는다 — 실제 스키마를 바꾸지 않고
경로만 보려는 것이라 임시 디렉토리를 `filesystem:` 위치로 얹는다. **버전은 커밋된 최대 + 1 로
뽑는다**(발견 6).

### 검사기 자신을 반증했다

**통과할 수 있는 검사는 통과하지 못하는 경우도 보여야 판정으로 쓸 수 있다.**

| | 무엇을 주입했나 | 결과 |
|---|---|---|
| 1 | baseline 을 프로브보다 높은 버전으로 찍은 DB | 프로브가 **조용히 건너뛰어진다**(예외 없음). 그래서 개수 단언이 판정으로 쓰인다 |
| 2 | 프로브를 적용한 DB와 안 한 DB의 fingerprint 비교 | 차이를 잡고, 그 차이가 프로브가 더한 그 컬럼이다 |
| 3 | V1 사본에 주석 한 줄 | checksum 이 움직인다 — 동결 상수가 파일 내용에 묶여 있다 |
| 4 | 앞 문장은 성공하고 뒤 문장이 깨지는 마이그레이션 | 부분 적용도 이력도 **남지 않는다**(Postgres DDL 트랜잭션) |
| 5 | `regen-fingerprint.sh` 에 임시 V2 · 깨진 SQL | fixture 가 589 → 590 줄로 커지고, 깨진 SQL 은 exit 3 으로 죽는다(`ON_ERROR_STOP`) |
| 6 | **진짜 `V2__` 를 커밋 위치에 넣고 관문 전체 재실행** | 13건 전부 통과. fixture 를 갱신하지 않으면 그 자리가 정확히 실패한다 |

1번이 특히 필요하다. **`ddl-auto: validate` 는 이 실패를 보증하지 못한다** — 건너뛴
마이그레이션이 Schema Entity 와 무관한 것(인덱스·제약·시드)이면 앱은 멀쩡히 뜬다.

4번은 운영 대응 절차의 전제다. **"실패 행이 이력에 남아 다음 기동도 막는다" 는 거짓이고**,
그렇게 적었다가 실행해 보고 고쳤다(§발견 5).

6번이 이 단계에서 가장 중요한 반증이다 — §발견 6 참조.

## 2. 발견

### 발견 1 — 테스트가 재현한다던 "dev·운영" 이 실물과 달랐다

관문이 처음 잡은 것이 이것이다. `FlywayBaselineTest` 가 baseline 을
`.baselineDescription("baseline")` 으로 찍고 있었는데, **실물은 Flyway 기본값
`<< Flyway Baseline >>`** 이다(`application.yml` 이 baseline 관련 값을 주지 않는다).

동작에 영향이 없는 값이지만, **"경로 A 재현" 이라고 부르는 자리에서 실물과 다른 DB 를 세워
놓고 있었다.** 지금은 `flywayFor` 가 baseline 값을 하나도 주지 않고, 이력 네 칸
(`version|description|type|checksum`)을 통째로 단언한다. 반증 1만 예외로 `baselineVersion` 을
다르게 준다 — 그것이 반증의 내용이기 때문이다.

### 발견 2 — `REQUIRE_ALEMBIC_CHECK` 는 alembic 것이 아니었다

CI 의 `api-java` 잡에서 파이썬 설치를 걷어내려 했는데, 이 변수를 **여섯 테스트가 공유**하고
있었다 — `CoachPromptParityTest` · `ReportPromptParityTest` · `PromptParityTest` ·
`AdminSchemaParityTest` · `FastApiInteropIT` · (그리고 이번에 사라진) `FlywayBaselineTest` 의
alembic 대조. 앞의 다섯은 프롬프트·관리자 스키마를 **파이썬 정본과 대조**하는 것이라 스키마
정본과 무관하게 유효하다.

**지웠다면 다섯이 조용히 건너뛰고 초록이 됐다.** CI 의 파이썬 설치는 5단계까지 남기고, 이번에는
이름과 실제 의미의 어긋남을 주석으로만 바로잡았다(`ci.yml` · 두 CLAUDE.md · SPEC §8-1).

🔎 2단계의 "하네스를 지우면 함께 사라지는 테스트가 있다" 와 같은 부류다 — **장치를 지우기 전에
그 장치의 이름이 아니라 그 장치를 쓰는 것들을 세라.**

### 발견 3 — V1 은 고칠 수 없으므로 낡은 주석을 안고 간다

V1 헤더에 `scripts/regen-baseline.sh 가 만든다` 는 안내가 남아 있는데 그 스크립트는 이제
없다(3단계에서 은퇴). 고치고 싶지만 **고치면 checksum 이 움직여 신규 환경만 죽는다** — 이 파일이
동결이라는 말의 뜻이 정확히 그것이다.

그래서 `db/migration/README.md` 를 새로 두어 정본을 옮겼다. Flyway 는 `.sql` 만 읽으므로
마이그레이션으로 오인되지 않는다(`migrationsExecuted == 1` 이 확인한다).

### 발견 4 — `check-refs.py` 가 2단계 참조 하나를 못 찾고 있었다

`spec/M6-contract-migration.md` 의 `manifest.py:CASES` 가 하네스 소스를 가리키는데
`PY_ROOTS` 에 하네스 경로가 없어 **오류 1건으로 빨간불**이었다(rebase 전에도 그랬다 — 2단계에서
새어나왔다). 경로를 더해 오류 0 으로 만들고, **하네스를 지우는 4단계에서 그 줄도 함께 지우도록**
주석에 적었다.

### 발견 5 — 실행하지 않고 적은 복구 절차가 거짓이었다

`docs/DEPLOY-VPC.md` §4-3 에 *"실패한 마이그레이션은 이력에 `success=false` 로 남고, 그대로
두면 다음 기동도 막힌다 → 그 줄을 지우고 재기동한다"* 를 적었다. **Postgres 에서는 거짓이다** —
DDL 이 트랜잭션 안에서 돌아 마이그레이션과 이력 기록이 함께 롤백된다. 지울 행이 없다.

SPEC §12-4(*"적어 두고 실행한 적 없는 명령은 사양이 아니라 추측이다"*)에 정확히 걸린 자리다.
지금은 반증 4가 실제로 확인하고 문서는 그 결과를 적는다.

### 발견 6 — **관문이 첫 `V2__` 를 막아설 뻔했다**

가장 큰 것이다. 신설 테스트가 프로브를 `V2__forward_probe.sql` 로 **하드코딩**했고,
`migrationsExecuted == 1` · `isZero()` 가 "V1 이 유일한 마이그레이션" 을 못박고 있었다.

**진짜 `V2__` 가 들어오는 순간 6건이 깨진다** — 그중 넷은
`Found more than one migration with version 2` 다. 스키마 드리프트가 아니라 **검사 자신이
낡은** 실패이고, `db/migration/README.md` 3번이 안내하는 바로 그 자리에서 터진다.
**3단계의 목적이 "스키마 변경이 Flyway 마이그레이션으로 들어간다" 인데 그 첫 변경을 3단계가
막는 셈**이었다.

지금은 프로브 버전을 `FlywaySupport.nextFreeVersion()`(커밋된 최대 + 1)이 뽑고, 개수는
`committedCount()` 가 센다. `existingDatabaseGetsBaselineOnly` 도 "아무것도 안 돈다" 가 아니라
"V1 이 다시 돌지 않는다" 로 좁혔다 — V2 는 **돌아야 맞기** 때문이다.

🔎 같은 부류를 이 저장소가 여러 번 겪었다(`PackageLayerTest.FEATURE_LAYERS`,
`PackageCycleTest.BUNDLES`). **손으로 박은 개수는 목록이 늘 때 따라오지 못한다.** 옳은 선례가
바로 옆에 있었다 — `freshDatabaseHasTheObjectsThatHibernateCannotCreate` 는 개수를 fixture 에서
센다.

## 3. 한계 — 이 초록이 보증하지 않는 것

⚠ **실서버에서 마이그레이션이 실제로 돈 것은 아니다.** V2 가 없으므로 dev·운영에서는 **다음
스키마 변경 때 처음** 돈다. 그때까지 이 단계의 판정은 위 반증 넷에 전적으로 기대고 있다.

⚠ **기동 대기 90초에 마이그레이션이 포함된다**(`ssm-deploy.sh` 의 `WAIT_HEALTHY_SECONDS`).
지금은 적용할 것이 없어 즉시 지나가지만, 큰 테이블에 인덱스를 거는 `V2__` 가 들어오면 여기서
걸린다. **그 값과 `be-java` 의 `WAIT_SECONDS` 를 함께 올려야 한다** — 한쪽만 올리면 성공한
배포가 빨간불이 된다.

🔥 **폭발 반경이 커졌다.** 예전에는 `migrate` 가 배포보다 **먼저** 도는 별도 스텝이라 실패해도
옛 프로세스가 그대로 떠 있었다 — 서비스는 살아 있고 배포만 빨간불이었다. 지금 마이그레이션은
`systemctl restart` **뒤에** 돌므로, 나쁜 마이그레이션은 배포 실패가 아니라 **서비스 중단**이다.
down 마이그레이션이 없으니 되돌리는 경로는 "되돌리는 새 마이그레이션" 하나뿐이고, 그래서
**"스키마를 먼저 넓히고 코드를 나중에 좁힌다" 가 권고가 아니라 유일한 안전망**이 됐다.
절차는 `docs/DEPLOY-VPC.md` §4-4 에 새로 적었다.

이 셋은 3단계가 **새로 떠안은 위험**이고, 코드가 아니라 문서로만 대응한다. 실제로 겪기 전에는
그 이상 할 수 있는 것이 없다 — 첫 `V2__` 가 그 시험이다.

## 4. 다음 단계에 미치는 영향

| 단계 | 반영할 것 |
|---|---|
| 4 (하네스 폐기) | ✅ 끝났다 — `check-refs.py` 의 스캔 경로를 지우고, M1\~M4 문서가 가리키는 폐기 도구 참조 34건은 **건수를 찍으며 면제**하도록 바꿨다 ([M6-harness-retirement.md](M6-harness-retirement.md) §6) |
| 5 (파이썬 삭제) | 죽은 스크립트 셋 삭제 — `ssm-deploy.sh` 의 `migrate` 분기 · `check-migration.sh` · `upload-api.sh`. 은퇴 표시만 달려 있고 아무도 부르지 않는다. `REQUIRE_ALEMBIC_CHECK` 와 CI 의 uv 스텝도 이때 사라진다 (발견 2) |
| 6 (문서) | `DEPLOY-VPC.md` §4-2 는 여전히 FastAPI 수동 설치 절차다. §4-3·6-4 는 이번에 Flyway 기준으로 고쳤다 |
