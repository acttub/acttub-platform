# M6 findings — 재해복구 리허설 (SOMA-403 1단계)

`spec/M6-cleanup.md` 산출물 A-1 과 티켓 1단계가 요구한 관문을 실제로 돌린 결과다.
추정이 아니라 실행 결과만 적었다.

- 실행: `apps/api-java/scripts/dr-rehearsal.sh` (Docker + uv + JDK)
- 환경: `postgres:18-alpine`(운영 RDS 와 같은 메이저), alembic HEAD `0016_backfill_memory_schema`
- 판정: **통과** — 실패 0건

## 0. 한 줄 결론

**`apps/api` 를 지워도 된다.** V1 만으로 세운 환경이 alembic 경로의 결과와 같고,
운영 덤프를 부은 뒤에도 앱이 선다. 다만 **재해복구 절차 넷을 지켜야** 성립한다(§3).

| 관문 | 결과 |
|---|---|
| V1 만으로 빈 DB 를 세워 alembic DB 와 같음 | ✅ 7종 비교 전부 같음 |
| owner · ACL · extension · sequence · 시드 실제 값 | ✅ fingerprint 가 못 보던 넷 모두 같음 (단서는 §2-6) |
| production-like role 로 baseline 과 앱 기동 | ✅ 비-superuser DB owner 로 V1 적용 + `ddl-auto: validate` 통과 |
| 데이터 복원 후 sequence 충돌 | ✅ `setval` 이 덤프에 실려 따라온다. **없으면 실제로 충돌하는 것까지 확인**(§C-1) |

## 1. 무엇을 어떻게 확인했나

M0 의 fingerprint 비교는 **카탈로그의 정의**만 본다. 그래서 스키마가 아니라
**두 경로를 끝까지 재현해 결과를 비교**했다 — 앱이 기동하며 심는 것이 따로 있기 때문이다(§2-2).

| | 경로 A (지금의 dev·운영) | 경로 B (재해복구·신규 환경) |
|---|---|---|
| 스키마 | `alembic upgrade head` | 빈 DB → 앱 기동 → Flyway 가 V1 적용 |
| Flyway | `FLYWAY_BASELINE_ONLY=true` 로 baseline 기록 후 평상시 재기동 | 없음 |
| role | `acttub` (NOSUPERUSER · NOCREATEDB · NOCREATEROLE, DB owner) | 같음 |

`deploy/bootstrap-dev.sh` 가 만드는 role 형태와 `deploy/ssm-deploy.sh` 의 `be-java-baseline`
절차를 그대로 옮겼다.

**비교 7종 전부 같다** — fingerprint 589줄 · extension 1 · sequence 상태 2 · owner 47 ·
ACL 28 · 테이블별 행수 25 · 시드 실제 값 3. extension 은 양쪽 다 `plpgsql v1.0` 하나뿐이다.

### 검사기 자신을 반증했다 (§C)

**통과할 수 있는 검사는 통과하지 못하는 경우도 보여야 판정으로 쓸 수 있다.** 스크립트가
매번 셋을 함께 돌린다 — 여기가 실패하면 위의 초록은 아무것도 뜻하지 않는다.

| | 무엇을 주입했나 | 결과 |
|---|---|---|
| C-1 | 덤프에서 `setval` 을 지우고 복원 | 다음 id 가 **1** — 이미 쓰인 값이다. PK 충돌을 실제로 잡는다 |
| C-2 | V1 에 주석 한 줄을 더한 사본으로 재기동 | 경로 B 는 `Migration checksum mismatch` 로 **죽고**, 경로 A 는 **산다** |
| C-3 | `GRANT SELECT ON users TO PUBLIC` 을 준 DB | ACL 비교가 차이를 잡는다 |

🔁 **2단계 리뷰에서 초록으로 끝나는 길이 하나 더 있었던 것이 드러나 고쳤다.** `diff_dbs` 는 늘
조건문 안에서 불려 `set -e` 가 꺼지는데, **두 쿼리가 다 실패하면 양쪽 파일이 비어 diff 가
성공**했다 — 같아야 정상인 자리에서는 `✔ 같음 (0줄)`, 달라야 정상인 자리에서는 `✔ 차이를
잡는다` 가 떴다. 아무것도 비교하지 않은 판정이다. 지금은 쿼리 실패를 `2` 로 갈라 양쪽 다
실패로 보고한다(함수만 떼어 실패를 주입해 확인).

C-1 이 필요한 이유가 따로 있다. 시퀀스 PK 는 `anomalies`·`coach_turns` 둘뿐이고 나머지는
uuid 다. **그 둘이 비어 있으면 "다음 id 가 비어 있다" 가 항상 참**이라 setval 이 통째로 빠져도
초록이 뜬다. 그래서 리허설은 `users → upload_intents → practice_sessions → summaries` 체인을
세우고 두 테이블에 각각 3행을 심어 시퀀스를 실제로 소비시킨다.

## 2. 발견

### 발견 1 — **V1 은 이제 고칠 수 없다** (3단계에 직접 영향)

두 경로의 `flyway_schema_history` 가 다르다.

| | 이력 | checksum |
|---|---|---|
| 경로 A (dev·운영) | `<< Flyway Baseline >>` type=**BASELINE** | **없음** |
| 경로 B (신규 환경) | `baseline` type=**SQL** | `-1135202796` |

**V1 을 수정하면 dev·운영은 멀쩡한데 신규 환경만 기동하지 못한다.** 지금은 신규 환경이 없어
아무도 모르지만, 재해복구가 필요한 순간에 드러난다.

관측이 아니라 **재현했다** — §C-2 가 V1 사본에 주석 한 줄을 더해 두 경로를 다시 띄웠고,
경로 B 만 `Migration checksum mismatch` 로 죽었다.

→ **3단계부터 스키마 변경은 `V2__` 로 들어간다. V1 은 동결이다.**
→ `apps/api-java/scripts/regen-baseline.sh` 는 V1 을 다시 만드는 도구라 **3단계에서 은퇴한다**
   (alembic 이 정본인 동안에만 성립하던 도구다).

### 발견 2 — V1 이 스키마와 시드의 전부가 아니다

`feature/consent/adapter/ConsentDocumentPublisher`(`ApplicationRunner`)가 **기동할 때마다**
동의 문서 3건을 `consent_documents` 에 올린다. alembic 에도 V1 에도 없는 데이터다.

리허설 첫 판이 이것 때문에 어긋났다 — 한쪽만 앱을 띄웠더니 `consent_documents rows=0` 대 `3` 이
나왔다. **"스키마를 만드는 것"과 "환경을 세우는 것"은 다르다.**

`uq_consent_documents_type_version UNIQUE (type, version)` 이 걸려 있어, 복원 데이터와
앱이 심는 것이 겹치면 충돌한다. §3 의 순서가 필요한 이유다.

### 발견 3 — 카테고리 id 는 비결정적이다

`community_categories.id` 는 alembic 0005 도 심지 않고 `gen_random_uuid()` 에 맡긴다.
**alembic DB 를 둘 만들어도 서로 다르다** — V1 의 결함이 아니다.

다만 결과는 남는다: **재해복구로 세운 환경의 카테고리 id 는 운영과 다르다.**
스키마만 새로 세우고 데이터를 따로 옮기면 `community_posts.category_id` 가 어디도 가리키지
못한다. 데이터를 통째로 복원하는 §3 절차에서는 문제가 되지 않는다.

### 발견 4 — `refresh_tokens` 는 자기참조라 복원에 관리 role 이 필요하다

`refresh_tokens.replaced_by_id → refresh_tokens.id` (토큰 회전 체인). `pg_dump` 가
"교차 참조" 로 경고하고 `--disable-triggers` 를 권한다. 그 옵션은 **복원 시 superuser 를
요구**하므로, 재해복구는 앱 role(`acttub`)이 아니라 **관리 role**(RDS 는 `rds_superuser`)로 돈다.

리허설은 회전 체인 2행을 실제로 넣어 복원 후 체인이 그대로인지 확인한다.

### 발견 5 — 덤프에서 마이그레이션 장부 둘을 빼야 한다

`--exclude-table=alembic_version` 만으로는 모자란다. **`flyway_schema_history` 도 빼야 한다.**

발견 1 때문이다 — 경로 A 의 이력을 경로 B 로 세운 DB 에 부으면 `installed_rank` PK 에서
깨지고, 설령 들어가더라도 **"V1 을 적용한 적 없다"고 기록된 DB** 가 된다.
리허설 첫 판이 실제로 이 지점에서 깨졌다.

### 발견 6 — owner·ACL 이 같은 이유는 **양쪽 다 아무것도 하지 않기 때문**이다

솔직히 적어 둔다. V1 에도 alembic 리비전 16개에도 `GRANT`·`OWNER TO`·`CREATE EXTENSION` 이
**하나도 없다**. 두 DB 를 같은 role 로 만들었으니 owner·ACL 이 같은 것은 당연하고,
"V1 이 `--no-owner --no-privileges` 라 무엇을 잃었는가" 의 답은 **잃을 것이 없었다** 이다.

검사기가 무력한 것은 아니다 — §C-3 이 `GRANT` 하나를 주입해 비교가 차이를 잡는 것을 보인다.

⚠ **다만 이것은 dev·운영 실 DB 의 ACL 과 대조한 결과가 아니다.** 누군가 운영 DB 에 손으로
`GRANT` 를 걸어 두었다면 재해복구본은 그것을 재현하지 못한다. 확인은 다음 한 줄이면 된다
(읽기 전용):

```sql
SELECT relname, relacl FROM pg_class WHERE relacl IS NOT NULL;   -- 빈 결과여야 한다
```

## 3. 재해복구 절차 (실측으로 성립을 확인한 순서)

> 📌 **6단계에서 이 절차를 `docs/DEPLOY-VPC.md` 로 옮긴다.** `spec/` 은 6단계에서 폐기되고,
> `dr-rehearsal.sh` 는 alembic 이 사라지는 5단계에서 함께 지워진다 — 그때 이 절차만 남는다.

**미리(재해 전)**: 백업은 마이그레이션 장부 둘을 빼고 뜬다.

```bash
pg_dump --data-only --disable-triggers \
  --exclude-table=alembic_version --exclude-table=flyway_schema_history \
  > backup.sql
```

**복구할 때**:

1. **빈 DB 를 만들고 앱을 띄운다.** Flyway 가 V1 을 적용하고 `ddl-auto: validate` 를 통과한다.
   앱 role 은 비-superuser DB owner 로 충분하다.
2. **앱이 심은 것과 V1 이 심은 것을 비운다.** 복원 데이터가 같은 것을 담고 있다(발견 2·3).

   ```sql
   TRUNCATE community_categories, consent_documents CASCADE;
   ```

   ⚠ `CASCADE` 가 `community_posts`·`community_comments`·`community_post_likes`·
   `community_anonymous_aliases` 까지 함께 비운다. **복원 직전의 빈 DB 에서만 돌린다.**
3. **관리 role 로 덤프를 붓는다** — `psql -U <관리 role> -d <db> -f backup.sql`.
   `--disable-triggers` 가 superuser 를 요구한다(발견 4). `setval` 이 덤프에 실려 시퀀스가
   따라온다(리허설 확인: `last=3` → 다음 id `4`).
4. **앱을 다시 띄운다.** 복원된 DB 에 동의 문서가 이미 있어도 기동이 깨지지 않는다(확인함).

**2번을 건너뛰면 깨진다.** 리허설의 B-1 이 그것을 매번 증명한다 —
`duplicate key value violates unique constraint "community_categories_slug_key"`.

## 4. 다음 단계에 미치는 영향

| 단계 | 반영할 것 |
|---|---|
| 3 (Flyway 정본화) | V1 동결 · 스키마 변경은 `V2__` 부터 · `regen-baseline.sh` 은퇴 (발견 1) |
| 5 (파이썬 삭제) | `dr-rehearsal.sh` 도 함께 삭제 — 경로 A 가 alembic 을 요구한다 |
| 6 (문서) | §3 절차를 `docs/DEPLOY-VPC.md` 로 옮긴다 |
