# 마이그레이션

API가 기동하는 도중에 Flyway가 이 디렉토리를 적용한다. 스키마 소유·V1 동결·fingerprint 갱신 규칙의 정본은
[CONTRACT §5-5](../../../../../CONTRACT.md#5-5-flyway-가-스키마를-소유한다)다.

- 스키마를 바꿀 때는 이 디렉토리에서 가장 큰 번호 다음으로 `V<번호>__<설명>.sql` 새 파일을 만든다(설명은
  소문자 snake_case).
- 🔥 **`V1__baseline.sql`은 주석까지 한 글자도 고치지 않는다.** 그래서 V1 머리 주석의
  `scripts/regen-baseline.sh 가 만든다`는 낡은 채로 남아 있다 — 그 스크립트는 alembic이 정본이던 시절의 도구라
  `SOMA-403` 3단계에서 은퇴했다. 그 주석 대신 CONTRACT §5-5를 믿는다.
- 컬럼 삭제·이름 변경은 [DB와 배포 안전성](../../../../../../../docs/BRANCHING-STRATEGY.md#db와-배포-안전성)의
  순서로 여러 릴리스에 나눈다.
