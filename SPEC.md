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

#### 확정된 설계 결정 (Codex 설계 비판 반영, 2차 개정)

Codex 비판에서 critical 2건·high 2건이 나왔고 **전부 코드로 검증해 수용**했다. 핵심은
M5·M6·M7을 개별 수정으로 다루면 서로 밟는다는 것이다. 공통 기반을 먼저 정의한다.

##### S1. 작업 소유권 state machine (선행 조건)

검증된 문제: `app/analyzing.tsx:81`의 `run()`이 mount(`:161`)와 재시도 버튼(`:203`)
양쪽에서 호출되는데 **실행 중 가드가 없다.** 재시도를 빠르게 두 번 누르거나 취소 직후
재진입하면 각자 compression uuid·UploadTask·AbortController·requestId를 가진 두
pipeline이 같은 `uploadRef`·`sessionIdRef`·AsyncStorage 키를 두고 경쟁한다. 단일 ref만
두면 후발 작업이 선행 handle을 덮어써 **선행 작업은 취소되지 않고**, 선행 작업의 늦은
cleanup이 후발 작업의 영속 상태를 지우거나 `startPractice`·`router.replace`를 실행한다.

- 화면별 boolean이 아니라 **generation 카운터를 가진 단일 operation**을 둔다.
- active operation이 있으면 `run()` 재진입을 막는다.
- 모든 콜백·스토리지 write/remove·navigation은 **자기 generation이 아직 active일 때만** 수행한다.
- cleanup은 **자기 generation의 자원만** 취소한다.
- 이 state machine은 `app/analyzing.tsx`가 아니라 **순수 모듈로 분리**해 테스트한다.

##### S2. 취소 어휘 3종 분리 (선행 조건)

검증된 문제: 현재 unmount cleanup은 화면 lifecycle만 나타내는데, `createPracticeSession`
이후 서버 분석은 독립적으로 계속된다. AbortController는 응답 대기·폴링만 끊을 뿐 서버
작업을 롤백하지 않는다. generic unmount를 "취소"로 보고 영속 레코드를 지우면 **M5의 재시작
복구가 사라지고 접근 불가 서버 세션이 남는다.** 반대로 항상 유지하면 사용자가 포기한
작업도 다음 실행에 다시 열린다. 즉 M5와 M7은 현재 서술로는 **서로 모순**이다.

| 어휘 | 발생 시점 | 동작 |
|---|---|---|
| `cancel-local` | 세션 생성 **전** 이탈 | 압축·PUT 취소, 이후 단계 진입 차단, 영속 레코드 없음 |
| `detach` | 세션 생성 **후** 이탈 | 폴링만 중단, **레코드 유지**, 서버 작업은 계속 |
| `abandon` | 사용자 명시적 포기 | 기존 삭제 경로 처리 후 레코드 제거 |

##### S3. 네트워크 취소 계약 (선행 조건)

검증된 문제: `lib/api.ts`의 `request()`가 자기 `AbortController`를 만들고(`:277`)
`signal: controller.signal`로 **호출자 signal을 덮어쓰며**(`:290`), 모든 AbortError를
타임아웃 문구로 바꾼다(`:310-311`). 401에서는 signal과 무관하게 shared `ensureRefreshed()`를
기다린 뒤 새 controller로 재귀한다(`:294`) — **화면 취소 중 refresh가 끝나면 요청이 부활**한다.
반대로 화면 signal을 single-flight refresh에 연결하면 한 화면의 취소가 다른 요청이 공유하는
refresh까지 죽인다.

- 외부 operation signal과 per-attempt timeout을 **합성**하되 abort 원인(`timeout` / `cancelled`)을 보존하는 단일 request primitive를 만든다.
- 취소 시 **shared refresh를 기다리는 것만** 중단한다. refresh 자체는 취소하지 않는다.
- retry 대기와 401 재시도 **전후로 signal을 재확인**한다.
- `lib/compress.ts:76`의 포괄 `catch`는 **네이티브 모듈 부재(원본 fallback)와 취소를 구분하지 못한다** — 지금 상태로 취소를 붙이면 취소가 "원본 업로드 성공"으로 둔갑한다. `cancelled`를 별도 결과로 반환하도록 좁힌다.
- `createUploadTask`의 취소 결과도 정상 응답과 구분한다.

##### M5 — 재정의: 서버 분석 단계 재개로 범위 축소

검증된 문제: `app/_layout.tsx:40`의 `RootNavigator`는 auth·consent만 gate하고 영속
분석을 읽는 단계가 없다. 복구 로드와 auth redirect가 각각 `router.replace`를 실행하면
tabs·consent·analyzing이 경합한다. 게다가 analyzing에 도착해도 `takePendingUpload()`가
없으면 즉시 upload로 되돌리고(`:154`), 완료 후 `startPractice`에는 로컬 `videoUri`가
필요하다(`:133-139`).

- 저장 시점을 **`createPracticeSession` 응답 이후**로 한정한다. `session_id` + `schemaVersion` + `owner`(user id)만 저장한다.
- 재시작 시 서버 detail로 hydrate한다(subtext·summary·playback URL). 로컬 원본 영상에 의존하지 않는다.
- **보장 범위를 명시한다**: 압축·PUT 중 종료, 그리고 세션 생성 응답 유실은 복구 대상이 아니다.
- auth와 recovery storage가 **모두 로드될 때까지 한 bootstrap owner가 최초 route를 결정**한다. `router.replace` 경합을 없앤다.
- `owner` 불일치(계정 전환)나 `schemaVersion` 불일치 레코드는 폐기한다.
- `TODO.md` 10번 "이어가기 페이지"는 만들지 않는다(별도 과제).

##### M6 — 재정의: idempotent POST에 한정

웹 loop 전체를 이식하면 `requestId`를 쓰는 모든 호출과 refresh를 한꺼번에 재구성하게 된다.
대신 **idempotent POST**(`/v2/uploads/intents`, `/v2/practice-sessions`, `/v2/coach/*`,
`/v2/reports`)에만 invocation 단위 requestId 스냅샷과 제한된 network·429·processing
재시도를 둔다. 참조 구현은 `apps/web/src/lib/api/v2/idempotency.ts`(`:89` ID 1회 생성,
`:99` 루프).
포기하는 것: 웹과 정책이 완전히 같지는 않고, 제한 횟수를 넘는 일시 장애는 사용자에게 노출된다.

##### M7 — 재정의: 세션 생성 전후로 의미가 다름

- 세션 생성 **전**: 압축(`cancelCompression` + uuid)과 PUT(`createUploadTask`) native 취소.
- 세션 생성 **후**: 서버 취소를 주장하지 않는다. `detach`로 정의한다.
- 각 `await` 뒤 generation을 검사해 `complete`·세션 생성 진입을 막는다.
- 남는 부작용을 인정한다: 이미 dispatch된 API와 서버 분석은 계속될 수 있고, finalized된 미사용 upload intent가 남을 수 있다.

##### M9 — 300초 통일

웹은 UI 문구("5분 이내")와 검증(`MAX_DURATION_MS = 300_000`)이 모두 300초다. 모바일
가이드 문구도 "5분 이내"이므로 330초가 유일한 예외다. 300초로 맞춘다.

##### 추가 엣지 케이스 (비판에서 수용, 전부 처리 대상)

| # | 시나리오 | 요구 동작 |
|---|---|---|
| E1 | 영속 세션이 다른 기기·기록 화면에서 이미 삭제돼 status가 404 | 레코드를 **terminal stale로 제거**한다. 안 하면 매 실행마다 analyzing에 들어가 같은 오류·재시도를 반복한다 |
| E2 | 재시도 중 토큰 만료로 single-flight refresh가 시작된 뒤 화면 취소 | caller 대기만 취소한다. shared refresh 자체를 abort하면 다른 화면의 동시 요청까지 죽는다 (S3) |
| E3 | 취소 직후 새 분석 진입, 이전 operation의 비동기 storage remove가 뒤늦게 완료 | **고정 키 금지.** 키를 session/generation 스코프로 두거나 remove 전에 소유 검사를 한다. 안 하면 이전 cleanup이 새 레코드를 지운다 |
| E4 | 서버가 세션을 만들었으나 응답 수신·저장 전에 프로세스 종료 | **복구 대상 아님**(M5 보장 범위 밖). 다만 사용자가 새 업로드를 만들 수 있음을 인정하고 문서화한다 |
| E5 | 압축 취소가 캐시에 부분 파일을 남김 (Codex도 hypothesis로 표시) | 압축 산출물만 정리한다. **원본 URI는 절대 삭제하지 않는다** |
| E6 | UploadTask가 마지막 바이트 전송 직후 취소돼 object는 존재하는데 client는 cancel을 받음 | cancel 결과를 정상 업로드로 처리하면 안 된다(`completeUpload` 실행 금지). 신호 확인 후 downstream 차단 |
| E7 | 분석 레코드가 남은 채 logout → 다른 계정 로그인 | 키에 `owner`를 넣고 불일치 시 폐기 (M5). 앱 재시작 시 `AuthProvider.user`가 복원되지 않는 점을 고려한다 |
| E8 | status는 `analyzed`인데 M11로 optional이 된 `summary`/`playback_url`이 detail에 없음 | 1회 재조회 후에도 없으면 **terminal error**로 처리한다(무한 폴링 금지) |

#### 구현 순서 (비판의 권고를 수용)

1. **W1 → W2** (완료)
2. **W3 + M9 → M11** — 업로드 입력 정규화와 실제 optional 응답 타입 확정
3. **M4 → S3 → M6** — refresh의 영구/일시 실패 구분을 먼저 만들고, 외부 signal·timeout 합성을 올린 뒤, 그 위에 재시도 루프
4. **M3 → M2 → S1/S2 → M5** — logout 정리, 세션 상태 전이, state machine, 영속 복구
5. **M7** — 확정된 state machine에 compressor uuid와 UploadTask 연결
6. **M1 · M8 · M10 → W5** — 독립 UI·오류 처리
7. **W6** — `upload.tsx`·AsyncStorage 변경이 끝난 뒤 마지막에 이식

근거: M4와 M6은 같은 `request()`·refresh 경계를 건드리므로 M4의 결과 모델이 먼저 필요하다.
M5는 unmount가 레코드를 유지할지 지울지 결정하므로 M7의 화면 cleanup보다 앞서야 한다.
W6는 W3/M9와 같은 `upload.tsx`, M5와 같은 AsyncStorage 영역을 건드리므로 마지막이 안전하다.

#### 기각한 제안

- **W6를 후속 작업으로 미루자** — 기각. 사용자가 이번 스코프로 명시했고, 브랜치의 유일한
  고유 가치다. 대신 구현 순서에서 **마지막에 배치**해 동시 변경 위험을 줄이는 것으로 대신한다.
- **AsyncStorage 대신 매 시작 `listPracticeSessions()` 조회** — 기각. Codex 자신도
  `recommend: false`로 표시했다. 매 시작 API 호출이 필요하고 복수 진행 세션 중 선택이
  모호하며 오프라인 복구가 불가능하다.
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

> **검증 원칙 (비판 수용)**: "근거가 있다" 같은 서술은 소스 문자열 확인만으로 통과
> 처리될 수 있어 완료 증명이 못 된다. 아래 항목은 **입력 → 기대 관찰**로 고정하고,
> 순수 모듈로 분리해 `node --test`로 실제 실행한다.
>
> 모바일 테스트 러너는 이미 존재한다: `apps/mobile/tests/consent-recovery.test.mjs`가
> `node:test`를 쓴다. 다만 **소스 문자열 검사 방식**이고 package script에도 없다.
> 실행 명령을 `node --test tests/`로 확정하고, 신규 테스트는 문자열이 아니라
> **mock fetch·mock storage·fake timer로 동작을 검증**한다.

**W3 — iOS 422**
- [ ] `asset.duration = 12345.678`일 때 길이 검사와 저장 값이 **동일한 `12346`**을 쓴다
- [ ] fetch 직전 request body의 `duration_ms`가 `12346`(정수)임을 모바일 테스트로 확인
- [ ] `12345.0` → `12345`, `null` → `null` 유지
- [ ] 비유한 값·0·소수 `size_bytes`는 fetch **전에** 거부된다 (fetch 호출 0회)
- [ ] 서버 계약 테스트가 소수 float 422 / 정수형 float 통과를 고정한다

**W4 — 모바일**

*순수 모듈로 분리해 실제 실행 검증하는 항목*
- [ ] **S1** 재시도 2회 연속 클릭 시 두 번째 `run()`이 무시된다(pipeline 1개). 이전 generation의 콜백·storage write/remove·navigation이 **실행되지 않는다**
- [ ] **S2** 세션 생성 **전** 이탈 → 압축·PUT 취소되고 `completeUpload` 호출 0회. 세션 생성 **후** 이탈 → 폴링 중단되지만 레코드 **유지**
- [ ] **S3** 취소 시 shared refresh는 죽지 않고, 취소 후 추가 fetch **0회**. abort 원인이 `timeout`과 `cancelled`로 구분된다
- [ ] **M6** processing 409 / 429 / network error / 401→refresh 각각에서 **모든 attempt의 `X-Request-Id`와 body 바이트가 동일**하다. refresh single-flight 호출 횟수와 backoff 중 취소 후 fetch 0회를 확인
- [ ] **M4** 401·422만 세션 파기, 429·5xx·network는 세션 유지하고 오류 전파
- [ ] **M2** status가 `failed`일 때만 `reanalyze` 호출. 그 외 상태에서는 호출 0회
- [ ] **M1** 서버가 오름차순으로 준 목록에서 최신 항목이 선택된다
- [ ] **E1~E8** 각 시나리오별 기대 동작 (위 표) — 최소 E1·E3·E6·E8은 테스트로 고정

*정적 확인으로 충분한 항목*
- [ ] **M3** 로그아웃이 `finally`에서 항상 로컬 토큰을 정리한다 (비-ApiError 포함)
- [ ] **M8** `coachSessionId` 없으면 입력 비활성 + 시작 재시도 버튼 존재
- [ ] **M9** 300초 상수 하나를 검증·문구가 공유한다
- [ ] **M10** DELETE 404가 성공과 동일 처리
- [ ] **M11** 조건부 필드가 옵셔널, `completeUpload.status`가 `'finalized'` literal

*런타임 미검증으로 분리 (완료로 세지 않는다)*
- [ ] **M5·M7 실기기 확인** — 압축·PUT·API 대기·폴링 각 단계 이탈과 재진입, 앱 강제 종료 후 복구. 이 파이프라인에서 실행 불가하므로 **"정적 구현 완료 · 런타임 미검증"**으로 보고한다

**W5 — 오류 문구**
- [ ] 500 응답(plain text)에서 한국어 문구가 표시된다 — `HTTP 500` 노출 금지
- [ ] 422 응답에서 Pydantic 영문 원문 대신 한국어 문구가 표시된다
- [ ] 리포트 생성 실패 후 재시도 버튼이 `createReport`를 다시 호출한다

**W6 — 이식**
- [ ] AsyncStorage `getItem`/`setItem` rejection에서 **unhandled rejection이 발생하지 않고** 가이드 표시 여부가 결정된다
- [ ] 계정별 표시 정책이 키에 반영된다 (또는 기기 단위 정책임을 코드에 명시)
- [ ] Modal·건너뛰기·다음 버튼에 접근성 역할/라벨이 있다
- [ ] `consent.tsx` 동의 행에 `accessibilityRole="checkbox"` + `accessibilityState`가 있다
- [ ] 가이드 문구의 길이 안내가 M9의 300초와 일치한다
- [ ] `feat/mobile-delete-fix-and-onboarding-ui`에서 살릴 것이 더 없음을 diff로 확인했다

**전체 검증**
- [ ] 백엔드: `uv run --package acting-api pytest` (cwd=`apps/api`)
- [ ] 백엔드 통합: `RUN_DB_TESTS=1 TEST_DATABASE_URL=... pytest acting-api/tests/test_db_store.py`
- [ ] 모바일 정적: `apps/mobile`에서 `npx tsc --noEmit` (별도 게이트로 유지 — 위 동작 검증을 대체하지 않는다)
- [ ] 모바일 동작: `apps/mobile`에서 `node --test tests/`
- [ ] 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test`

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
