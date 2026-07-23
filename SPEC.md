# SPEC — 리포트 500 장애 + 모바일 계약 정합성 일괄 수정

기준 커밋: `40f1f6d`(dev) · 브랜치: `feat/report-and-mobile-fixes`
작업 위치: `/Users/insung/Documents/GitHub/acttub/acttub-wt-fixes` (격리 worktree)

## 배경 / 목적

2026-07-23 감사에서 서로 독립적인 세 갈래 결함이 확인됐다. 모두 코드·실행 출력으로 검증했다.

1. **리포트 미출력 (운영 장애)** — `PostgresStore._report_count_query`가 만드는 SQL에
   `FROM reports`가 없어 Postgres가 거부한다. `POST /v2/reports`가 500으로 죽고
   **웹·앱 양쪽에서 리포트가 나오지 않는다.**
2. **iOS 업로드 422** — 모바일이 `asset.duration`(iOS에서 Double)을 정수화 없이
   `duration_ms: int`로 보내 intent 생성이 422로 막힌다.
3. **모바일 계약 정합성 11건** — dev 머지 후에도 남는 모바일 고유 결함. 웹·백엔드를
   기준으로 대조해 확정했다.

부수적으로 두 장애 모두 **사용자에게 영문 원문(`HTTP 500`, Pydantic 메시지)이 그대로
노출**되는 문제가 함께 드러났다.

## 설계

### W1. 백엔드 — 리포트 count 쿼리 (긴급)

`apps/api/acting-api/src/acting_api/db/store.py:1294` `_report_count_query`에 명시적
FROM 앵커를 지정한다.

현재 컴파일 결과(검증됨):
```
FROM practice_sessions JOIN coach_sessions ON reports.session_id = ...
  JOIN practice_sessions ON ...        -- reports 없음 + practice_sessions 중복
```
목표:
```
FROM reports JOIN coach_sessions JOIN summaries JOIN practice_sessions
```

수정본은 이미 작성돼 worktree에 적용돼 있다(`.select_from(DbReport)` + 회귀 테스트).
**이 파이프라인에서는 검증·보강만 한다.**

### W2. 테스트 게이트

이 회귀를 잡을 수 있는 `tests/test_db_store.py`가 `RUN_DB_TESTS != "1"`이면 통째로
skip된다(53-54행). `test_report_store_queries.py`는 가짜 Session이라 SQL을 실제
실행하지 않고 부분 문자열만 본다.

- SQL 문자열 검증을 **FROM 앵커·중복 JOIN까지** 확인하도록 강화
- Postgres 통합 테스트 실행 명령을 확정하고 `apps/api/AGENTS.md`에 문서화한다.
  이번 파이프라인에서 **실제로 돌려 통과를 확인**한다.

> 결정: 저장소에 CI 설정(`.github`)이 없다. "CI 필수 경로"는 달성 불가이므로 로컬 검증
> 명령 확정 + 문서화로 재조정한다. CI 신설은 스코프 밖.
> 로컬 Postgres가 `localhost:5432`에서 동작 중이고 DB `acting_local`이 있다. 통합 테스트
> fixture는 `acting_test_<uuid>` 스키마를 만들었다 지우므로 기존 데이터에 영향이 없다.

### W3. 모바일 — 숫자 타입 (iOS 422)

`apps/mobile/app/upload.tsx:71` `setDurationMs(asset.duration ?? null)`을 한 곳에서
정규화한다. 유한한 양수면 반올림 정수 밀리초, 아니면 `null`. 길이 검사와 `setDurationMs`가
**같은 정규화 값**을 쓴다.
`lib/api.ts`의 `createUploadIntent` 경계에서도 `duration_ms`·`size_bytes`가 양의 정수인지
검사해 요청 전에 막는다.

서버 스키마는 바꾸지 않는다 — DB가 `Integer`이고 웹도 `Number.isInteger`를 요구한다.

### W4. 모바일 — 계약 정합성 11건

| # | 문제 | 위치 | 수정 방향 |
|---|---|---|---|
| M1 | 리포트 목록 정렬 역전 (서버 오름차순인데 `records[0]`을 최신으로 사용) | `app/(tabs)/index.tsx:64` | `created_at` 내림차순 명시 정렬 |
| M2 | 재시도가 상태 확인 없이 `reanalyze` → 409 `session_is_not_failed` | `app/analyzing.tsx:91-93` | 먼저 status 조회, `failed`일 때만 재분석. `analysis_retry_exhausted`도 분기 |
| M3 | 오프라인 로그아웃 시 토큰 미삭제 (비-ApiError rethrow) | `lib/auth.tsx:168-171` | 서버 로그아웃은 best-effort, 로컬 정리는 `finally`에서 항상 |
| M4 | refresh의 429·5xx를 영구 실패로 처리해 세션 파기 | `lib/api.ts:235`, `293-298` | 401/422만 영구 실패. 일시 오류는 세션 유지하고 전파 |
| M5 | 진행 중 연습이 메모리 전용이라 앱 종료 시 복구 불가 | `lib/practice.ts:35`, `app/analyzing.tsx:47,154` | **AsyncStorage 영속화 + 분석 재개** (아래 결정 참조) |
| M6 | `X-Request-Id`가 호출마다 새로 생성돼 idempotency 무력화 | `lib/api.ts:285` | **웹과 동일한 재시도 루프 도입** (아래 결정 참조) |
| M7 | 화면 이탈해도 압축·PUT·complete·세션 생성이 계속 진행 | `app/analyzing.tsx:97,114,162` | **전면 취소** (아래 결정 참조) |
| M8 | `coachStart` 실패 후 재시도 UI 없음, 전송 버튼 무반응 | `app/coach.tsx:61,108,210` | 시작 재시도 버튼 추가, `coachSessionId` 없으면 입력 비활성 |
| M9 | 영상 길이 제한 330초 (웹 300초) | `app/upload.tsx:47` | **300초로 통일**, 안내 문구와 검증값이 같은 상수 참조 |

#### 확정된 설계 결정

**M5 — AsyncStorage 영속화 + 분석 재개**
`practice_session_id`와 `subtext`를 진행 중 AsyncStorage에 저장하고, 앱 재시작 시 분석
화면으로 복귀해 폴링을 재개한다. 완료·취소 시 제거한다.
expo-router는 앱 종료 후 내비게이션 상태를 보존하지 않으므로 라우터 파라미터만으로는
부족하다. `TODO.md` 10번 "미완료 연습 이어가기 별도 페이지"는 **만들지 않는다**(별도 과제).

**M6 — 웹과 동일한 재시도 루프**
`apps/web/src/lib/api/v2/idempotency.ts`를 참조 구현으로 삼는다. 웹은 `requestId`를
루프 밖에서 한 번 만들고(89행) `while(true)` 루프에서 동일 ID·동일 body로 `processing`·
429·네트워크 오류를 재시도한다. 모바일에 같은 구조를 도입한다.

**M7 — 전면 취소**
압축은 `react-native-compressor`의 uuid + `cancelCompression`, 업로드는 `uploadAsync`
대신 취소 가능한 `createUploadTask`, API 호출은 `AbortController`로 중단한다.
세 경로 모두 공유 취소 신호를 받는다.
주의: `uploadAsync` → `createUploadTask` 교체는 네이티브 동작 변경이므로 이 파이프라인의
정적 검증만으로는 부족하다 — **실기기 확인이 필요함을 최종 보고에 명시한다.**

**M9 — 300초 통일**
웹은 UI 문구("5분 이내")와 검증(`MAX_DURATION_MS = 300_000`)이 모두 300초다. 모바일
가이드 문구도 "5분 이내"이므로 330초가 유일한 예외다. 300초로 맞춘다.
| M10 | 삭제 404를 실패 알럿으로 표시 | `app/report-detail.tsx:66-71` | 404를 idempotent success로 처리 |
| M11 | 수기 타입이 실제 계약보다 과선언 | `lib/api.ts:130,146,386` | 조건부 필드를 옵셔널로, `completeUpload.status`는 `'finalized'` literal |

### W5. 오류 문구 (두 장애에서 드러난 공통 결함)

- `lib/api.ts` `friendlyError`에 **500·422 케이스가 없어** 영문이 그대로 노출된다
  (`HTTP 500`, Pydantic 원문). 한국어 문구로 매핑한다.
- `app/report.tsx`는 리포트 생성 실패 시 **재시도 경로가 없다**(마운트 1회 `useEffect`).
  재시도 버튼을 추가한다 — M8과 같은 패턴.

### W6. first-upload-guide 이식

폐기할 `feat/mobile-delete-fix-and-onboarding-ui`(073c326)에서 고유 가치만 dev 위로 옮긴다.

- `components/first-upload-guide.tsx` (신규 134줄)
- `app/upload.tsx` — import + `!prefilled` 조건부 mount 2 hunk
- `app/consent.tsx` — `✓` 텍스트 → `MaterialIcons` 교체

이식하면서 감사에서 나온 자체 결함도 함께 고친다:
- `AsyncStorage.getItem`에 `.catch` 없음 → unhandled rejection (42행)
- `setItem` 실패 무시 (53행)
- `SEEN_KEY`가 계정 구분 없는 기기 전역 → 공용 기기에서 다음 계정이 가이드를 못 봄
- 가이드 문구 "5분 이내"가 실제 검증(330초)과 불일치 → W3/M9로 함께 해소
- Modal·조작 버튼에 접근성 역할 없음
- `app/consent.tsx` 동의 행에 `accessibilityRole="checkbox"`/`accessibilityState` 없음

## 완료 기준 체크리스트

**W1 — 리포트 500**
- [ ] `_report_count_query` 컴파일 결과가 `FROM reports`로 시작하고, `practice_sessions`가 JOIN에 정확히 1회만 등장한다
- [ ] `uv run --package acting-api pytest` 전체 통과
- [ ] `RUN_DB_TESTS=1` Postgres 통합 테스트에서 `complete_report_operation`이 예외 없이 `report_count`를 반환한다

**W2 — 테스트 게이트**
- [ ] SQL 형태 회귀 테스트가 FROM 앵커와 중복 JOIN 부재를 모두 검증한다
- [ ] Postgres 통합 테스트 실행 방법이 문서화되고 실제로 통과한다

**W3 — iOS 422**
- [ ] `12345.678` 입력이 `duration_ms: 12346` 정수로 전송된다
- [ ] `12345.0`은 `12345`로 유지, `null`은 `null`로 유지
- [ ] 비유한 값·0·소수 `size_bytes`는 fetch 전에 거부된다
- [ ] 서버 계약 테스트가 소수 float 422 / 정수형 float 통과를 고정한다

**W4 — 모바일 11건**
- [ ] M1~M11 각각 수정되고, 해당 동작을 검증하는 테스트 또는 근거가 있다

**W5 — 오류 문구**
- [ ] 500·422에서 사용자에게 한국어 문구가 표시된다
- [ ] 리포트 생성 실패 시 재시도 버튼이 동작한다

**W6 — 이식**
- [ ] `first-upload-guide.tsx`가 dev 위에서 동작하고 위 6개 자체 결함이 해소됐다
- [ ] `feat/mobile-delete-fix-and-onboarding-ui`에서 살릴 것이 더 없음을 diff로 확인했다

**전체 검증** (기존 SPEC의 검증 관례를 따름)
- [ ] 백엔드: `uv run --package acting-api pytest` (cwd=`apps/api`)
- [ ] 모바일: `apps/mobile`에서 `npx tsc --noEmit`
- [ ] 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test`
- [ ] 웹·앱 리포트 생성 경로가 실제로 복구됐음을 확인 (Phase 4 verify)

## 하지 말 것 (스코프 제한)

- 서버의 `size_bytes`/`duration_ms` 스키마를 float 허용으로 바꾸지 않는다
- 리포트·업로드와 무관한 리팩터링, 스타일 정리, 의존성 업그레이드 금지
- `apps/web` 코드 수정은 이번 스코프가 아니다 — 다만 W1이 웹 증상도 함께 고치므로 웹 동작 확인은 한다
- `feat/mobile-delete-fix-and-onboarding-ui` 브랜치를 머지하지 않는다 (W6로 대체)
- API 계약(요청/응답 스키마)은 바꾸지 않는다 → `spec/openapi.json`·`v2-schema.d.ts` 재생성 불필요
- 생성물 수정 금지: `node_modules/`, `out/`, `.venv/`, `apps/web/src/lib/api/v2-schema.d.ts`
- 커밋은 phase 단위로 남기되 **push는 하지 않는다**

## 미결 사항

1. **M5·M6·M7은 구조 변경 성격**이다. 다른 항목이 국소 수정인 것과 달리 화면 간 상태
   흐름과 네트워크 계층을 건드린다. 각각 별도 커밋으로 분리하고, 스코프가 감당 범위를
   넘으면 남은 부분을 최종 보고에 명시한다.
2. **실기기 검증 불가** — M7의 `createUploadTask` 교체, M5의 앱 재시작 복구, first-upload-guide의
   AsyncStorage 실패 경로는 정적 검증으로 확인할 수 없다. 최종 보고에 "실기기 확인 필요"로
   분류해 남긴다.
3. **모바일 검증 환경** — worktree에 `apps/mobile/node_modules`가 없다. 메인 체크아웃의
   것을 심볼릭 링크로 연결해 `npx tsc --noEmit`과 `expo lint`를 돌린다(같은 커밋 기반이라
   버전 드리프트 없음).
