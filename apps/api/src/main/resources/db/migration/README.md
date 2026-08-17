# 마이그레이션

**스키마 정본은 여기다**(`apps/api/CONTRACT.md` §5-5, `SOMA-403` 3단계). 배포는 jar 하나만 보내고,
앱이 뜨는 도중에 Flyway 가 이 디렉토리를 적용한다 — 별도 마이그레이션 명령이 없다.

## 스키마를 바꾸려면

1. `V2__<설명>.sql` 로 **새 파일**을 만든다 (번호는 이어서, 설명은 소문자 snake_case)
2. `scripts/regen-fingerprint.sh` 를 돌려 `baseline-schema-fingerprint.txt` 를 갱신한다
3. `./gradlew test --tests '*Flyway*'` 로 확인하고 둘을 함께 커밋한다
4. 배포는 `main`/`dev` push 하나다. **되돌리기 어려우므로 스키마를 먼저 넓히고 코드를 나중에
   좁힌다** — 컬럼 삭제·이름 변경은 PR 을 둘로 나눈다(`docs/DEPLOY-VPC.md` 6-4)

## 🔥 `V1__baseline.sql` 은 동결이다 — 한 글자도 고치지 않는다

**주석 한 줄을 더해도 안 된다.** 두 경로의 이력이 다르기 때문이다.

| | 이력 | checksum |
|---|---|---|
| dev·운영 | `<< Flyway Baseline >>` type=**BASELINE** | **없음** |
| 신규 환경·재해복구 | `baseline` type=**SQL** | `-1135202796` |

**V1 을 수정하면 dev·운영은 멀쩡한데 신규 환경만 `Migration checksum mismatch` 로 기동하지
못한다.** 지금은 신규 환경이 없어 아무도 모르고, 재해복구가 필요한 바로 그 순간에 드러난다.
관측이 아니라 재현한 것이다 — `docs/archive/soma287/M6-findings.md` 발견 1·§C-2.

`FlywayBaselineTest.baselineIsFrozen` 이 위 checksum 을 못박아 이 실수를 CI 에서 잡는다.
**값의 정본은 그 테스트의 `FROZEN_BASELINE_CHECKSUM` 이다** — 위 표는 설명이고, 어긋나면
테스트가 이긴다.

### ⚠ 그래서 V1 의 헤더 주석은 낡은 채로 있다

파일 안에 `scripts/regen-baseline.sh 가 만든다` 는 안내가 남아 있는데, **그 스크립트는
없다**(alembic 이 정본이던 시절의 도구라 3단계에서 은퇴했다). 고치고 싶겠지만 고치면 위의
일이 벌어진다. **낡은 주석을 안고 가는 것이 동결의 값이다.** 대신 이 파일이 정본이다.
