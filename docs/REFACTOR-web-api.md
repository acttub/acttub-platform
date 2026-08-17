# 웹·API 정리 계획 (2026-08-08 아키텍처 리뷰)

`apps/web`과 `apps/api`를 훑어 나온 후보를 실행 단위로 쪼갠 문서다. **작업이 끝나면 `docs/archive/`로 옮긴다.**

> 🔁 **남은 것은 2단계뿐이다 (2026-08-18 확인).**
> - **1단계 — 완료.** `workspace-app.tsx`가 `buildPracticeSessionRequest`를 호출한다.
> - **3·4단계 — 대상이 사라졌다.** 둘 다 파이썬(`acting_summary`·`acting_agent`·`acting_report`의 도달 불가 앱, 중복 리포트 헬퍼)이 대상이었고, `SOMA-403` 5단계가 파이썬 트리를 통째로 지웠다. 아래 서술은 그 시점의 기록이다.
>
> 2단계를 끝내면 이 문서를 `docs/archive/`로 옮긴다.

리뷰는 코드를 직접 읽어서 했고, 아래 수치와 `파일:줄` 근거는 전부 확인한 것이다. 리뷰 시점의 HEAD는 `chore/SOMA-313-repo-cleanup`이다.

## 판정 기준

두 가지만 썼다.

- **deletion test** — 지웠을 때 복잡도가 사라지면(호출자 0) 지운다. 여러 호출부로 흩어지면 그 module은 값을 하고 있는 것이다.
- **응답 바이트를 움직이는가** — 응답 계약의 정본은 Spring Boot(`apps/api`)이고, 계약을 지키는 것은 그쪽 Java 테스트다. `apps/web`은 `spec/openapi.json`으로 타입을 생성한다. **움직이지 않는 것만 지금 한다.**

---

## 실행 단계

네 단계는 독립 PR이고, 1→2와 3→4는 앞 단계가 전제다. 1·2(web)와 3·4(api)는 서로 독립이라 병렬로 가도 된다. 각 PR은 CI 두 잡(`web`·`api`)을 통과해야 하고, 브랜치·PR 제목에 SOMA 이슈 키가 필요하다.

### 1단계 — 씬 텍스트 trim 누락 (실제 버그)

`fix(web): 씬 텍스트를 보낼 때 공백을 다듬는다`

**무엇이 문제인가.** `practice-setup-flow.ts:44` `buildPracticeSessionRequest`가 `situation`·`character_context`·`goal`을 `.trim()` 해서 요청을 만들고, `tests/practice-contract-regression.test.mjs:29`가 그 trim을 단언한다. 그런데 **살아있는 경로는 그 함수를 부르지 않는다** — `workspace-app.tsx:434-441`이 body를 인라인으로 조립하면서 raw state를 그대로 넘긴다:

```ts
const { session } = await createPracticeSession({
  upload_intent_id: intentId,
  situation,            // useState("") → 입력 핸들러 직결, 중간 trim 없음
  character_context: character,
  goal,
  ...blockage,
}, { signal: controller.signal });
```

`situation`/`character`/`goal`은 `workspace-app.tsx:155-157`에서 `useState("")`로 만들어져 `:847-849`의 입력 핸들러(`setSituation` 등)로 직결된다. 그래서 `"  카페에서  "`가 패딩째 FastAPI로 간다. 테스트는 초록이다.

**변경.** `workspace-app.tsx:434`가 `buildPracticeSessionRequest(intentId, { situation, characterContext: character, goal }, blockage)`를 호출하게 한다. 1파일, 약 8줄.

**검증.** `pnpm --filter web test`(현재 190 통과) → `pnpm build` → `pnpm typecheck`.
**위험.** 낮음. 되돌리기는 `git revert`.
**왜 맨 앞인가.** 이 함수의 유일한 호출자가 2단계에서 지울 파일이다. 순서를 바꾸면 trim을 지키는 테스트가 함께 지워지면서 버그를 고칠 근거도 사라진다.

### 2단계 — 라우트가 쓰지 않는 연습 화면 삭제

`chore(web): 라우트가 더 이상 쓰지 않는 연습 화면을 지운다`

**근거.** `src/` 전체에서 두 파일을 실제로 import하는 곳이 **0개**다. 남은 참조는 전부 "되돌리려면 이 import를 되돌리면 된다"는 주석이다.

| 파일 | LOC |
|---|---:|
| `src/features/practice/practice-flow.tsx` | 1,739 |
| `src/features/practice/practice-single.tsx` | 610 |
| `src/features/practice/analysis-failure.ts` | (위 둘만 씀 — 전이적으로 죽음) |

합쳐서 **2,349줄, 수기 `src/`(12,334줄)의 19%**다. 죽어 있는데도 커밋이 계속 붙는 이유는 테스트가 이 파일들의 **소스 텍스트**를 정규식으로 단언하기 때문이다 — 고치지 않으면 테스트가 깨진다.

**삭제 대상 테스트.** `tests/upload-ui-contract.test.mjs`(21개 단언 중 19개가 죽은 파일 대상), `tests/practice-flow-wiring.test.mjs`(전부). `tests/practice-contract-regression.test.mjs`와 `tests/practice-blockage-flow.test.mjs`는 죽은 파일을 겨냥한 부분만 발췌 제거한다(전자는 1단계 덕분에 살아있는 경로를 지키게 된다).

**주석 정리.** `app/home/page.tsx:8` · `app/practice/new/page.tsx:7` · `app/practice/history/page.tsx:7` · `workspace-app.tsx:7` · `lib/config/env.ts:29-30` · `features/practice/analysis-progress.ts:10`.

**검증.** `pnpm --filter web test` → `build` → `typecheck` → `lint`.
**위험.** 중간(삭제 범위가 큼). 삭제라 revert로 완전 복구된다.

> **열린 결정 ①** — 죽은 파일에만 있고 살아있는 화면에 없는 behaviour가 하나 있다. `analysisFailure(error_code)`가 분석 실패를 오류 코드별 안내로 바꿔주는데, `workspace-app.tsx:562-566`은 실패 시 그냥 `mode="preparing"`으로 되돌린다.
> **(a)** 지금 살려서 작은 module로 옮긴다 / **(b)** 같이 지우고 별도 이슈로 남긴다.
> 권고는 **(b)** — 삭제 PR에 기능 추가를 섞으면 revert가 어려워진다.

### 3단계 — 도달할 수 없는 독립 앱과 미사용 배선 삭제

`chore(api): 도달할 수 없는 독립 앱과 미사용 배선을 지운다`

**근거.** 게이트웨이의 `include_router` 10개는 **전부 `acting_api.*`로 직접 만든 라우터**다. 서브패키지에서 가져오는 것은 engine·schema와 요청 DTO 2종뿐이고, `app.mount()`로 붙는 서브 앱은 없다(`StaticFiles` 마운트만 있다). 그래서 서브패키지들이 각자 갖고 있는 독립 FastAPI 앱은 배포된 요청이 닿을 수 없다:

- `acting_summary.app`은 **자기 테스트(`test_app.py`)에서만** import된다.
- `acting_summary.router`는 그 `app.py`에서만 import된다. `POST /summarize`는 `spec/openapi.json`에 없다.
- `acting_agent/app.py` · `acting_report/app.py`도 같다.

`acting_summary/router.py`는 최근 200커밋 기준 7번 수정됐다 — 도달 불가 코드에 붙은 유지보수다.

**죽은 배선.** `create_app`의 `agent_settings=None`(`app.py:93`)·`report_settings=None`(`:94`)은 `acting-api/src` 전체에서 **정의 2줄이 전부**다. 읽는 곳이 없는데 테스트 9개가 매번 넘겨준다.

**순서.**
1. DTO 이사 — `CoachStartReq`·`CoachReplyReq` → `acting_agent/schema.py`, `ReportReq` → `acting_report/schema.py`. `coaching.py:11`·`reports.py:22`가 남의 **router 모듈**에서 DTO를 빌려오던 것이 사라진다.
2. 삭제 — `acting_summary/{router,app}.py`, `acting_agent/app.py`, `acting_report/app.py`, `acting-summary/tests/test_app.py`.
3. 삭제 — `app.py:93-94` kwargs 2개와 이를 넘기는 테스트 9곳의 인자.

**검증.** `uv sync --frozen --all-packages` → `uv run --package acting-api pytest` → **`spec/openapi.json` 재생성 후 diff 0 확인(필수 게이트, 여기서 diff가 나오면 즉시 중단)** → `RUN_DB_TESTS=1 TEST_DATABASE_URL=... pytest acting-api/tests/test_db_store.py`.
**부수 효과.** Spring Boot 이관이 읽어야 할 코드가 줄어든다.

### 4단계 — 중복 헬퍼 통합

`refactor(api): 리포트 생성 헬퍼를 한 곳으로 모은다`

`_generate_report`가 `reports.py:58-76`과 `coaching.py:129-147`에 **`diff` 결과 완전히 동일**하게 존재한다. `_fail`(`reports.py:38-44`, `coaching.py:110-116`)도 같다.

**변경.** 둘을 `sync_operations.py`로 옮기고 두 파일이 import한다. `sync_operations.py`는 이미 이 영역에서 가장 깊은 module이다 — 멱등·리스·fingerprint·canonical JSON 인코딩을 함수 3개 뒤에 감춘다.

**이번에 안 하는 것.** `report_engine.generate_report`의 키워드 9개를 값 하나(`ReportRequest`)로 좁히는 것은 interface 변경이라 별도 논의 대상이다(호출 형태가 `coaching.py:137`·`:163`·`reports.py:66` 세 곳에 복제돼 있다).

**검증.** `pytest` → `openapi.json` diff 0.
**위험.** 낮음(바디가 바이트 단위로 동일함을 확인).

---

## 열린 결정

1. **2단계의 `analysisFailure`** — 지금 복구(a) vs 같이 지우고 별도 이슈(b). 권고 (b).
2. **Jira 이슈** — 단계마다 SOMA 이슈가 필요하다. 누가 만들지 정한다. 현재 브랜치 `chore/SOMA-313-repo-cleanup`은 성격이 달라 재사용하지 않는다.

---

## 이관이 끝난 뒤로 미룬 것

전부 응답 바이트나 `openapi.json`을 움직이는 항목이다.

> 🔁 **아래 넷은 파이썬 구조에 대한 관찰이고, 그 트리는 사라졌다.** 살아남은 것은 **오류
> 문자열이 통일돼 있지 않다**는 사실뿐이며(그 값들은 지금도 계약이다), 자바 기준의 현황은
> `ErrorContractInventoryTest`가 센다.

- **store의 ORM 행 22개 → DTO 전환.** `db/store.py`의 22개 메서드가 `User`·`PracticeSession` 같은 ORM 행을 그대로 돌려주고, 그 값이 라우터 payload 조립에 직접 물려 있다. (`db/community_store.py`는 이미 dataclass DTO를 돌려준다 — 같은 저장소 안의 모범 사례다.)
- **오류 문자열 통일.** `detail="..."`가 93곳, 고유값 45개, snake_case와 산문이 섞여 있다(`practice_session_not_found` vs `practice session not found`). **이 값들은 살아있는 계약이다.** 통일은 파괴적 변경이므로 이관 후 계약 변경으로 처리한다. 지금 할 수 있는 안전한 조치는 값을 **한 글자도 바꾸지 않고** 상수 module 하나로 위치만 모으는 것까지다.
- **조건부 라우터 4개를 무조건으로.** `create_app`이 `isinstance(store, PostgresStore)`로 community 라우터(`app.py:117`)와 분석 워커(`:148-152`) 장착 여부를 결정한다. **테스트가 보는 앱과 운영 앱의 라우터 집합이 다르다.** 라우트 표가 바뀌므로 이관 중엔 손대지 않되, **`create_app()`의 라우트 표를 그대로 단언하는 테스트를 하나 추가하는 것은 지금 해도 안전하다**(계약을 안 건드림).
- **`responses={}` → `response_model=`.** 라우터가 `responses={...: {"model": X}}`를 쓰고(36곳) `response_model=`은 `admin.py`에만 2곳이다. 즉 FastAPI가 나가는 payload를 런타임에 검증하지 않는다. 바꾸면 직렬화 필터링이 붙어 응답 바이트가 움직인다.

---

## 이번에 손대지 않는 큰 후보

각각 따로 설계 논의가 필요한 것들이다. 근거 수치만 남긴다.

**apps/web**

- **세션 열기가 두 벌.** `openSession`(`workspace-app.tsx:531-585`)과 `?session=` 효과(`:587-633`)가 같은 45줄을 각자 구현하고 **이미 다르다** — 전자는 `setBusy`/`setDrawerOpen`을 만지고 `activeIdRef`로 staleness를 판정하는데, 후자는 안 만지고 `cancelled` 클로저를 쓴다. 한쪽만 고치면 다른 쪽이 조용히 남는다. `openPracticeSession(id, {signal}) → WorkspaceView` 판별 union으로 접는 방향. `WorkspaceInner`는 818줄에 `useState` 28개 + `useRef` 10개다.
- **테스트의 seam이 소스 텍스트.** 단언 519개 중 **139개가 `assert.match`로 파일 내용을 검사한다**. 식별자 rename이나 JSX 순서 변경만으로 깨지고, 반대로 배선이 틀려도 토큰 순서만 맞으면 통과한다. 근본 원인은 `tests/ts-module-loader.mjs`가 `@/` 별칭을 해석하지 못해 `workspace-app.tsx`를 아예 import할 수 없다는 것 — **"서버 로직 금지" 룰 때문이 아니다.** 로더를 고치면 `features/` 절반이 열린다.
- **인증이 8개 module에 흩어지고 둘이 샌다.** `use-require-auth.ts:38`이 token-store의 private 키를 문자열 리터럴(`"acttub.refresh_token"`)로 알고 있어 rename하면 크로스탭 로그아웃 감지가 조용히 죽는다. `refresh.ts:14-17`은 API 계층에서 `window.location.replace()`로 하드 내비게이션을 하는데, 같은 이벤트에 `use-require-auth`의 `router.replace()`가 붙어 있어 둘이 경합한다.
- **`lib/auth/providers.ts`는 deletion test에 걸린다.** `googleProvider`·`appleProvider`가 항등 함수고, 호출부 2곳은 `login("google", credential)`로 대체된다. 이 pass-through를 방어하는 테스트 파일이 3개다. seam이 필요하면 진짜 behaviour가 있는 `apple-id.ts`·`google-gis.ts`(테스트 0개) 쪽에 둔다.
- **`features/community/`(1,132줄) + `v2/community.ts`에 테스트가 하나도 없다.** `@/` import가 없어 현재 로더로도 바로 테스트 가능하다 — 제약이 아니라 선택이다.
- 자잘한 중복: `wait()`·`abortReason()`이 `v2/idempotency.ts`와 `v2/sessions.ts`에 같은 구현으로 두 벌. abort 헬퍼가 `media/abort.ts`와 `v2/uploads.ts`에 **다른 메시지**로 두 벌(같은 `File`이 양쪽을 지난다). `AuthUser`가 `token-store.ts`에 손으로, `v2/types.ts`에 생성 타입으로 두 번 선언 — 오늘은 우연히 일치하고 `generate:v2-schema`가 조용히 깨뜨릴 수 있다.

**apps/api**

- **61개 메서드 store에 선언된 interface가 없다.** `db/store.py`는 2,374줄, public 메서드 61개인데 Protocol도 ABC도 없다. seam은 진짜다(Postgres + 인메모리 fake, adapter 2개). 하지만 아무도 검사하지 않아 **fake가 6개를 빠뜨렸고**(`admin_sessions`·`admin_stats`·`create_practice_session`·`transition_practice_session_status`·`engine`·`from_url`), 그 결과 **`admin.py`(113줄, 엔드포인트 2개)는 테스트가 하나도 없다.** 소비자 slice별 Protocol 선언은 런타임을 안 바꾸므로 지금 해도 안전하다.
  - 부수 발견: 22개 메서드가 세션 밖으로 **detached ORM 행**을 돌려준다. lazy 관계 접근 시 `DetachedInstanceError`가 나는데, fake는 `SimpleNamespace`라 절대 재현하지 못한다. `apps/api/CLAUDE.md`가 적어둔 "Postgres 전용 회귀"의 두 번째 종류다.
- **`config.py`가 config module이 아니다.** `GatewaySettings`는 20필드에 fail-fast 검증 6종으로 그 자체는 멀쩡하다. 문제는 **밖에 로더가 셋 더 있다**는 것이다 — `OPENAI_API_KEY`가 4곳, `OPENAI_CHAT_MODEL`이 5곳에서 `os.environ`으로 읽히는데 `GatewaySettings`는 둘 다 모른다. `ADMIN_OPS_TOKEN`은 `app.py:253`에서 인라인으로 읽혀 admin 라우터의 존재 여부를 결정한다.
  - **숨은 순서 제약:** `app.py:109-111`에서 `load_gateway_settings()`가 먼저 `.env`를 `os.environ`에 밀어넣어야 `load_summary_settings()`가 산다. 후자의 기본 env 경로는 `apps/api/video-feedback/.env`인데 **그 디렉토리는 존재하지 않는다.** 두 줄 순서를 바꾸면 기동이 죽고, 그 제약은 어디에도 적혀 있지 않다.
  - 예외: `RENDER_GIT_COMMIT`(`app.py:245`)은 `/health` **응답 바디 안**에 있으므로 계약 표면이다. 옮기지 않는다.

---

## ADR 개정이 필요한 두 건

결정을 뒤집자는 게 아니라 현실을 반영한 개정 표시가 필요하다. ADR-005·006·008이 이미 쓰는 개정 블록 형식 그대로.

- **ADR-003** — "Next.js Route Handler를 임시 API로 사용할 수 있으며 `/api/v1/*`를 선호한다." 현재 `apps/web`의 하드 룰은 "서버 로직을 여기 두지 않는다"이다. 개정 표시가 없어 ADR만 읽으면 Route Handler를 만들어도 된다고 읽힌다.
- **ADR-AI-006** — "세 서비스의 라우터를 하나의 FastAPI 앱에 in-process로 마운트." 실제로는 게이트웨이가 라우터를 직접 만들고 서브패키지에서는 engine·schema만 가져온다. **3단계를 하면 이 어긋남의 잔해가 사라지므로, 그 PR에서 함께 개정한다.**
