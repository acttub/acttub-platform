# M3 — 도메인 이관

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M3 사이클에만 적용된다.**

> **상세화 시점**: 이 문서는 M0·M2의 findings가 나온 뒤 사이클 진입 시 그룹별로 보강한다. 지금 확정된 것은 순서·위험 지점·완료 기준이다.

## 목적

엔드포인트 약 50개를 이식한다. 가장 긴 사이클(3.5주 예상)이며 **`db/store.py` 2,118줄 + `community_store.py` 749줄이 실제로 옮겨지는 구간**이다.

## 순서

의존이 적은 것부터. 각 그룹이 끝날 때마다 하네스를 돌린다.

| # | 그룹 | 엔드포인트 | 주된 위험 |
|---|---|---|---|
| 1 | `/v2/me`, `/v2/consents` | 2 + 3 | `DISTINCT ON` 2건(`store.py:419`, `478`) |
| 2 | `/v2/uploads` | 2 | `UPDATE...RETURNING`, presign 리전 고정, 숫자 파싱(12.0→201 / 12.5→422) |
| 3 | `/v2/practice-sessions` | 6 | **위험 함수 #2**, 조건부 키 생략(summary/error_code), 멱등 전이표 |
| 4 | `/v2/community` | 16 | `community_store.py` 749줄. **위험 함수 #5**, 키셋 커서, 차단 필터, 익명 별칭 |
| 5 | `/v2/reports` | 3 | **위험 함수 #1**, canonical JSON replay |
| 6 | `/v2/admissions`, `/admin` | 2 + 2 | 조건부 LEFT JOIN, `admin_sessions`의 N+1(`store.py:2089`) |

`/v2/coach`(2개)는 LLM 의존이라 **M4로 넘긴다.** M3에서는 저장·조회 계층만 준비한다.

## 위험 함수 5개 — 그룹보다 먼저 처리

`/SPEC.md` §7-1의 표를 따른다. 각각을 **먼저 프로토타입 + Testcontainers 테스트로 고정**한 뒤 해당 그룹을 이식한다.

1. `complete_report_operation` — M0에서 확정한 트랜잭션 스타일 적용
2. `create_practice_session_with_analysis_operation` — 보상 로직(`store.py:697-714`). 유사 구조가 `create_analysis_retry_operation`(723)에 복제되어 있으므로 **둘을 함께 본다**
3. `_save_coach_session` + `_load_session` — `FOR SHARE OF` + 턴 전량 값 비교
4. `claim_next_external_operation` — M4에서 워커가 쓰지만 저장 계층은 여기서
5. `_ensure_alias` — SAVEPOINT 재작성. 제안 형태:
   ```sql
   INSERT INTO community_anonymous_aliases (id, post_id, user_id, ordinal)
   SELECT ?, ?, ?, COALESCE(MAX(ordinal),0)+1 FROM community_anonymous_aliases WHERE post_id=?
   ON CONFLICT (post_id, user_id) DO NOTHING RETURNING ordinal
   ```
   **alias 발급 실패가 댓글 작성 전체를 롤백시켜야 하는지**를 결정한다(현재는 `RuntimeError`로 전체 롤백).

## 커뮤니티 — 별도 주의

- **키셋 커서**: `list_posts`(`community_store.py:261-270`)는 DESC, `list_comments`(`568-577`)는 **ASC로 방향이 반대**다. 복붙 이식 시 버그가 난다. base64 커서 인코딩(`133-146`)까지 그대로
- **차단 필터**: `_not_blocked`(`149-156`)가 3곳에서 재사용된다. Spring에서도 재사용 가능한 형태(`Specification`)로
- **좋아요 재집계**: `/SPEC.md` §7-1. 증감으로 되돌리지 않는다
- **댓글 수 원자적 증감**: `/SPEC.md` §7-2. 벌크 UPDATE로 분리 + 캐시 무효화
- **읽기는 토큰 없이 200** (`/SPEC.md` §6 #16)

## 완료 기준 체크리스트

- [ ] 엔드포인트 48개(coach 2개 제외) 이식 완료
- [ ] 위험 함수 5개가 각각 Testcontainers 테스트로 고정됨
- [ ] **M1 하네스 전량 통과** — L1/L2/L3 전부
- [ ] 오류 계약 40종이 status·detail까지 일치
- [ ] `openapi.json` diff 0 (datetime 통일 제외)
- [ ] 조건부 키 생략이 정확히 재현됨 (`summary`/`error_code`)
- [ ] 멱등 전이표 4케이스 통과
- [ ] `X-Request-Id` 응답 헤더 반환
- [ ] v1 경로 5개 404
- [ ] 동시성 테스트: 세션 생성 경합, 재분석 경합, lease 경합 (`test_db_store.py:422`, `481`, `751` 대응)
- [ ] Java가 더 엄격해져 생긴 diff는 **확인 후 수용**으로 기록됨 (`/SPEC.md` §8-3)

## 하지 말 것

1. `/v2/coach` 이식 금지 — M4
2. LLM 호출 코드 작성 금지 — M4
3. `admin_sessions`의 N+1은 **고쳐도 된다**(응답이 같다면). 단 기록한다
4. 기존 `apps/api` 수정 금지
5. 스코프 밖 리팩터링 일체
