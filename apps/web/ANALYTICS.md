# 웹 계측 (GA4 · Amplitude)

두 도구를 **역할을 나눠** 쓴다. 하나로 합치지 않는다.

| 도구 | 답하는 질문 | 코드 |
| --- | --- | --- |
| **GA4** | 어느 채널·캠페인이 방문과 가입을 만들었나 | `src/lib/analytics/ga.ts` |
| **Amplitude** | 들어온 사람이 제품 안에서 무엇을 하고 어디서 멈추나 | `src/lib/analytics/amplitude.ts` |

GA4는 유입용 서브프로젝트 6개(voice·acti·stage·mono·pick·link)가 같은 측정 ID를 공유하므로 **빼지 않는다.** Amplitude로 대체하려 들면 채널 귀속이 깨진다.

---

## 1. 지켜야 하는 것

`ga.ts` 첫 주석의 원칙이 Amplitude에도 **그대로** 적용된다. 하나라도 풀면 개인정보처리방침과 어긋난다.

### (1) 동의 전에는 아무것도 저장하지 않는다

GA4는 `consent: denied` 상태에서 쿠키 없이 히트를 보내지만, **Amplitude는 동의 전에는 초기화 자체를 하지 않는다.** 조건은 GA4와 동일하다 — `isLoggedIn() && hasAcceptedCurrentPrivacy()` (`src/features/analytics/analytics.tsx`).

동의 전에 쌓인 이벤트는 **버린다.** 큐에 모았다가 동의 후 흘려보내지 않는다. 그렇게 하면 "동의 전에는 수집하지 않는다"는 약속이 "동의 전에는 전송하지 않는다"로 슬쩍 바뀐다.

### (2) autocapture와 세션 리플레이가 켜져 있다

```ts
amplitude.add(sessionReplayPlugin({ sampleRate: 1 }));   // init 앞에 붙여야 첫 세션부터 잡힌다
amplitude.init(API_KEY, undefined, { autocapture: true });
```

> **`@amplitude/unified` 의 `initAll` 을 쓰지 않는다.** `initAll` 은 analytics·session replay 에
> 더해 **experiment 와 engagement(가이드·설문)까지 조건 없이 초기화한다** — unified 소스에
> engagement 를 끄는 옵션이 없다(`unified.js` 의 `add(EngagementPlugin(...))` 이 무조건 실행된다).
>
> 2026-08-11 로컬 확인에서 `cdn.amplitude.com/engagement-browser/...` 청크 15개+와
> `gs.amplitude.com/sdk/v1/{config,decide,state}` 호출이 붙는 것을 보고 걷어냈다. Engagement 는
> 앱 안에 가이드·설문 UI 를 띄울 수 있는 기능이라 쓰지도 않는데 켜 둘 이유가 없고, 방침 v4 에
> 고지된 경로도 아니다. 걷어내면서 SDK 청크가 gzip **115KB → 90KB** 로 줄었다.
>
> 지금은 analytics 와 session replay 둘만 명시적으로 붙인다 — Amplitude 의 Next.js 가이드가
> 쓰는 방식이다. 나중에 experiment 나 가이드가 필요해지면 그때 해당 플러그인만 추가한다.

**2026-08-11 최우영 결정으로 자동 수집과 화면 녹화를 전부 켰다.** 그래서 아래가 Amplitude로 나간다 — 방침이 이걸 전부 고지해야 하고, 이 목록이 곧 방침 6항의 수집 항목이다:

- **전체 주소** — autocapture 페이지뷰가 `location.href`를 통째로 싣는다: `/practice/history?session=<uuid>`, `/community/post?id=<uuid>`, `/login?next=<경로>`
- **클릭한 요소의 텍스트** — 좌측 레일 항목 제목은 **사용자가 직접 쓴 상황 텍스트**다(`workspace-app.tsx`의 `headlineBySession`). 커뮤니티 글 제목도 같다.
- **화면 녹화 100%** — `sampleRate: 1`. 연습 영상이 재생되는 화면, 장면 3칸, 코치 대화 전문, 연습 노트가 전부 들어간다.

수동으로 쏘는 21개 이벤트는 그대로 §1(7)의 화이트리스트를 지킨다. 자동 수집을 켰다고 **우리가 만드는 payload까지 느슨해지지는 않는다** — 두 경로는 별개다.

⚠️ **마스킹은 설정하지 않았다.** Amplitude Session Replay는 텍스트·입력을 가리는 옵션을 따로 제공한다. 지금 설정은 받은 지침 그대로이고, 마스킹을 넣으려면 여기서부터 손대면 된다.

#### ⚠️ 빌드는 반드시 webpack 으로 — Turbopack 에서는 녹화가 죽는다

`package.json` 의 `build` 가 **`next build --webpack`** 인 이유다. **떼면 세션 리플레이가 조용히 죽는다.**

리플레이 SDK 는 rrweb 레코더를 **동적 import** 로 늦게 불러온다(`getRecordFunction`). Turbopack 이 만든 그 청크가 `SyntaxError: Invalid or unexpected token` 으로 깨지는데, SDK 가 예외를 삼키고 null 을 돌려주므로 녹화가 **시작조차 되지 않는다**:

```js
case 3:
  this.loggerProvider.warn("Failed to load rrweb-record module:", n);
  return [2, null];      // ← 여기로 빠진다
```

증상이 고약하다 — 빌드도 배포도 초록이고, 이벤트는 정상으로 들어가고, `AMP_SR_START` 키와 리플레이 ID 까지 멀쩡히 생긴다. **IndexedDB 에 리플레이 버퍼 DB 가 없는 것**(`AMP_diagnostics_*` 하나만 있음)과 `api-sr.amplitude.com` 요청이 0건인 것으로만 구분된다.

2026-08-11 에 같은 코드로 두 번 빌드해 확인했다:

| 번들러 | 콘솔 | 리플레이 업로드 |
| --- | --- | --- |
| Turbopack (기본) | `Uncaught SyntaxError` | **0건** |
| webpack (`--webpack`) | 깨끗 | **`sessions/v2/track` 200 × 6** |

#### ⚠️ 코드의 `sampleRate` 는 서버 원격 설정에 덮인다

**`initAll` 에 넣은 `sampleRate: 1` 이 최종 값이 아니다.** SDK 는 기동할 때
`https://sr-client-cfg.amplitude.com/config/<key>?config_group=browser` 를 받아 그 값을 쓴다.
Amplitude 가 Admin 에서 정한 개인정보 설정을 존중하도록 그렇게 설계돼 있고, **원격 설정이
로드에 실패하면 아예 한 세션도 캡처하지 않는다.**

2026-08-11 에 이것 때문에 리플레이가 하나도 안 잡혔다. 코드는 100% 인데 서버 응답이:

```json
"sessionReplay": { "sr_sampling_config": { "capture_enabled": true, "sample_rate": 0.01 } }
```

**1%** 였다. 100세션에 1개만 녹화되니 테스트 몇 번으로는 영원히 안 보인다.

**녹화가 안 보이면 코드를 고치기 전에 저 URL 을 먼저 찍어봐라.** `capture_enabled` 와
`sample_rate` 가 실제 적용값이다. 바꾸는 곳은 코드가 아니라 **Amplitude 프로젝트 설정**이다.

화면 전환은 autocapture와 별개로 `screen_viewed`도 직접 쏜다 — 이쪽은 주소가 씻긴 값이라 퍼널의 시작점으로 쓸 수 있다.

### (3) 주소는 경로만, UUID는 가린다

`scrubUrl()`(`src/lib/observability/sentry-shared.ts`)을 재사용한다 — 쿼리·해시를 떼고 경로의 UUID를 `<id>`로 치환한다. 허용 목록이 아니라 제거 방식이라 **새 쿼리가 생겨도 자동으로 걸러진다.** GA4의 `toTrackedQuery`는 캠페인 파라미터를 남겨야 해서 허용 목록을 쓰지만, Amplitude는 캠페인을 볼 필요가 없으므로 더 강한 쪽을 쓴다.

### (4) 환경은 호스트가 아니라 키로 나눈다

GA4는 `isMeasuredHost()`로 로컬 트래픽을 막지만, Amplitude는 그 가드를 두지 않는다. **환경별로 다른 프로젝트 키를 주입해 통계를 나눈다** — Sentry가 `NEXT_PUBLIC_SENTRY_ENV`로 하는 것과 같은 방식이고, 이래야 로컬에서 설치를 확인할 수 있다.

그래서 **dev와 운영에 같은 키를 주면 두 환경의 데이터가 한 프로젝트에 섞인다.** `deploy.yml`의 `AMPLITUDE_API_KEY_WEB`을 환경별로 다르게 둘 것.

### (5) 켜고 끄는 스위치는 API 키 하나다

`NEXT_PUBLIC_AMPLITUDE_API_KEY`가 비어 있으면 **아무 일도 일어나지 않는다.** Sentry의 `isSentryEnabled()`와 같은 패턴이다. 별도 feature flag를 만들지 않는다 — 스위치가 둘이면 어느 쪽이 껐는지 헷갈린다.

> ⚠️ **개인정보처리방침 v4가 시행되기 전에는 운영 환경에 키를 넣지 않는다.** 방침 5항 위탁표에 Amplitude가 없는 상태에서 켜면 고지 없이 제3자에게 이용 기록을 넘기는 것이 된다.

### (6) `user_id`는 백엔드 내부 식별자만

`getStoredUser().id`만 쓴다. 이메일·표시 이름·소셜 sub는 넣지 않는다. 로그아웃·재동의 요구 시 `reset()`으로 지운다 — `analytics.tsx`가 이미 `session-events`와 `storage`를 듣고 있으므로 같은 자리에 붙인다.

### (7) 이벤트 속성은 화이트리스트다

**절대 싣지 않는 값** — 한 번 나가면 되돌릴 수 없다:

연습 세션 UUID · 업로드 intent id · 파일명 · 장면 3칸 텍스트(situation/character/goal) · 막힘 상세 텍스트 · 대화 입력과 응답 본문 · 노트 본문과 제목 · 표시 이름 · 이메일 · 커뮤니티 글·댓글 본문과 id · 입시 검색어 원문 · 원본 영상 길이(ms)와 파일 크기(byte)

숫자는 **버킷으로 뭉갠다.** 원본 밀리초·바이트는 특정 연습을 짚어내는 지문이 된다.

> 세션 id는 **중복 방지 열쇠로만** 쓴다 — `workspace-app.tsx`의 `countStepOnce` 패턴을 그대로 복사한다. 열쇠로 쓰되 전송하지 않는다.

---

## 2. 버킷

`ga.ts`의 `toDurationBucket`은 그대로 재사용하고, 나머지는 `amplitude.ts`에 둔다.

| 함수 | 구간 |
| --- | --- |
| `toDurationBucket(ms)` (기존) | `<30s` `30-60s` `60-180s` `180s+` `unknown` |
| `toSizeBucket(bytes)` | `<10MB` `10-30MB` `30-60MB` `60MB+` `unknown` |
| `toWaitBucket(ms)` | `<30s` `30-60s` `60-120s` `120s+` `unknown` |
| `toLengthBucket(chars)` | `<20` `20-60` `60-150` `150+` |
| `toAgeDaysBucket(days)` | `0` `1-3` `4-7` `8-30` `30+` |
| `toPctBucket(pct)` | `0-25` `25-50` `50-75` `75-99` |

---

## 3. 이벤트 사전 (1차 21개)

이벤트를 더 늘리기 전에 **이 21개로 답이 나오는지 먼저 본다.** 커뮤니티·입시 계측은 2차로 미룬다 — 지금 답해야 할 질문(퍼널 이탈·리텐션·대화 품질)에 필요 없다.

> **설치 검증용 임시 이벤트 1개가 따로 있다.** `Viewed Home Page` — `startAmplitude()`의 `initAll` 바로 뒤에서 한 번 발생하며 `{ prompt_version: "BA400.4" }`를 싣는다. Amplitude Setup 페이지의 라이브 피드에 이 이름이 뜨는 것으로 설치를 확인한다. **확인이 끝나면 지운다** — 아래 21개와 달리 제품 질문에 답하지 않는다.

### A. 연습 퍼널 — "어디서 나가나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `practice_prep_opened` | prep 모드 진입 | `entry`: `new` \| `reset` |
| `practice_video_selected` | 파일 선택 완료 | `size_bucket`, `is_reselect` |
| `practice_blockage_started` | 막힘 선택 화면 진입 | — |
| `practice_blockage_submitted` | "이대로 이어가기" | `kind`, `sub_branch`, `has_detail` |
| `practice_upload_failed` | 업로드·세션 생성 실패 | `stage`: `preflight`\|`intent`\|`put`\|`complete`\|`session_create`, `reason_code` |
| `practice_session_created` | 세션 생성 성공 | `duration_bucket`, `kind`, `sub_branch` |
| `practice_analysis_settled` | 분석 종료 | `result`: `analyzed`\|`failed`, `error_code`, `wait_bucket` |

`practice_blockage_started` → `practice_blockage_submitted` 사이의 낙차가 **"막힘 선택이 어렵다"의 크기**다. 그리고 `blockage_submitted` → `upload_failed`는 지금 구조상 가장 아픈 이탈이다: 업로드 전처리 예외가 막힘 3단계를 **다 고른 뒤에야** 사용자에게 보인다(`startUpload`의 rejection이 `begin`의 `await`에서 처음 터진다). 6분짜리 영상을 올린 사람은 질문을 다 고르고 나서 튕긴다. 이 두 이벤트가 그 층의 크기를 처음으로 보여준다.

`error_code`는 `PracticeSessionDetail.error_code`의 4종 enum(`gemini_timeout`·`gemini_parse_error`·`unsupported_media`·`max_attempts_exceeded`)을 그대로 싣는다. 지금 화면은 이 값을 전혀 쓰지 않는다.

`reason_code`는 HTTP status 숫자 또는 `network`·`aborted` 같은 고정 문자열만. **에러 메시지 원문을 넣지 않는다** — 서버 메시지에 무엇이 실려 올지 보장할 수 없다.

`stage`의 `session_create`는 업로드가 **전부 끝난 뒤** 세션 생성에서 터진 실패다. `UploadError`가 아니라서 단계를 스스로 알리지 못하므로 `begin()`이 표시를 남긴다. 이걸 `preflight`와 한 칸에 묶으면 "영상이 문제였다"와 "서버가 거절했다"가 섞인다 — 후자는 실사용자 4명이 이탈했던 자리다(`sessions.ts`의 `fillBlankScene` 주석).

`practice_video_selected`에 영상 길이를 싣지 않는 이유: 파일을 고른 순간에는 브라우저가 메타데이터를 아직 읽지 않아 **항상 `unknown`**이 된다. 늘 unknown인 속성은 진짜 미상과 구분되지 않아 없느니만 못하다. 길이는 `practice_session_created`에서 확정값으로 본다.

### B. 질문 대화 — "대화가 실제로 굴러가나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `practice_dialogue_started` | 첫 질문 도착 | `with_evidence`, `kind`, `sub_branch` |
| `practice_dialogue_start_failed` | 코치 연결 실패 | `restart` |
| `practice_dialogue_turn_sent` | 배우가 답 전송 | `turn_index`, `answer_length_bucket` |
| `practice_dialogue_turn_failed` | 답장 실패 | `turn_index` |
| `practice_dialogue_completed` | `status === "complete"` 수신 | `turn_count`, `report_type`, `ended_by` |
| `practice_result_viewed` | 노트 본문 표시 | `report_type`, `turn_count`, `source` |

`with_evidence`는 분석 성공 여부다 — 분석이 실패해도 "그냥 시작"으로 대화에 들어갈 수 있고, 그 두 갈래의 완주율이 같은지는 지금 알 방법이 없다.

`turn_count`는 **실측이 유일한 진실**이다. `TURN_BUDGET = 8`은 하드 컷오프가 아니라 프롬프트에 "남은 응답"으로 실려 모델이 배분할 뿐이라, 실제 턴 수는 세션마다 다르다.

`report_type`의 `blocked`가 핵심이다 — 실질 답변이 2개 미만이면 노트 대신 blocked 리포트가 나간다(`coaching.py`의 `_MIN_ANSWERS_FOR_REPORT`). "대화는 시작했는데 노트를 못 받은 사람"의 정확한 크기가 여기서 나온다.

`practice_dialogue_turn_failed`는 **지금 완전히 보이지 않는 실패**다. 답장 실패의 catch가 에러 상태 대신 가짜 AI 말풍선("연결이 잠시 끊겼어요…")만 넣기 때문에, 계측이 없으면 영원히 모른다.

`ended_by`: `coach`(모델이 complete) \| `actor_closing`("그만"·"종료"·"끝"·"여기까지").

⚠️ `actor_closing` 판정은 **프론트가 백엔드의 `is_closing`(`engine.py`)을 흉내 낸 것**이다. 응답에 종료 사유가 실려 오지 않아 어쩔 수 없이 재구현했고, 백엔드 규칙이 바뀌면 이 값만 조용히 어긋난다. `turn_count`·`report_type`은 서버 응답에서 직접 오므로 영향받지 않는다 — `ended_by`만 참고값으로 읽어라.

### C. 이탈과 재방문 — "다시 오나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `practice_abandoned` | preparing·chat 상태로 화면 이탈 | `mode`, `turn_count`, `pct_bucket` |
| `practice_history_opened` | 좌측 레일에서 지난 연습 열기 | `status`, `has_note`, `age_days_bucket` |
| `exit_review_opened` | 후기 창 열림 | `trigger`: `x`\|`leave`\|`back`, `mode` |
| `exit_review_submitted` | 후기 제출 | `trigger` |

`practice_history_opened`의 `age_days_bucket`이 리텐션의 실질 지표다 — Amplitude의 리텐션 차트가 "재방문"을 세는 것과 별개로, **지난 연습을 실제로 다시 열어보는지**가 이 제품에서 값이 있는 행동이다.

### D. 인증 — "들어오다 막히나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `login_completed` | 로그인 성공 (동의를 이미 마친 계정) | `provider` |
| `login_failed` | 로그인 실패 | `provider`, `reason_code` |
| `consent_submitted` | 약관 제출 | `result`: `ok`\|`partial_fail`\|`forced_logout` |

⚠️ **`login_completed`에는 신규 가입자가 잡히지 않는다.** 동의가 남은 계정은 로그인 직후 약관 화면으로 가고, 그 시점엔 Amplitude가 켜져 있지 않다. §1(1)의 결과이지 버그가 아니다 — 소급 전송하지 않는다. 그래서 이 이벤트에 "동의 대기 여부" 속성을 두지 않았다(늘 같은 값이 된다). **신규 가입자는 `consent_submitted`로 센다.** 가입 전환율 자체는 GA4로 본다.

### E. 화면 — "무엇을 쓰나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `screen_viewed` | 라우트 변경 | `path` (`scrubUrl` 통과) |

`path`는 경로만 남고 UUID는 `<id>`로 치환된다. GA4의 `page_view`와 중복이지만, Amplitude에서 퍼널·리텐션의 시작점으로 쓰려면 같은 프로젝트 안에 있어야 한다.

---

## 4. 늘릴 때

이벤트를 추가하려면 **이 문서의 표를 먼저 고친다.** 표에 없는 이벤트를 코드에서 직접 쏘지 않는다.

호출은 전부 `src/lib/analytics/amplitude.ts` 안의 래퍼 함수로만 한다 — `ga.ts`의 "이 파일 밖에서 `gtag`를 직접 부르지 않는다"와 같은 규칙이다. 그래야 속성 화이트리스트를 한 곳에서 강제할 수 있고, 금지 키가 payload에 없다는 테스트도 한 곳만 보면 된다.

2차 후보(지금은 넣지 않음): 커뮤니티 글·댓글·좋아요, `auth_wall_hit`(비로그인이 로그인 필요 동작을 누름), 입시 필터·외부 링크 이탈, 막힘 1·2단계 개별 선택과 되돌리기 횟수.

---

## 5. 운영

### 켜는 순서 — 틀리면 되돌릴 수 없다

**방침 발행이 먼저, 키 주입이 나중이다.** 순서가 바뀌면 고지 없이 이용 기록과 화면 녹화가 수탁사로 넘어가고, 이미 전송된 것은 되돌릴 수 없다.

이건 기억에 맡기지 않는다 — `deploy.yml`의 **`계측 키가 방침 고지보다 앞서지 않는지`** 가드가 막는다. 키가 설정돼 있는데 `consent-docs/manifest.json`이 발행 중이라고 선언한 방침 문서에 `Amplitude` 문자열이 없으면 **배포가 실패한다.** 같은 가드가 `EXPECTED_PRIVACY_VERSION`과 manifest 버전이 어긋나는 것도 막는다 — 어긋나면 동의 게이트가 영영 안 열려 계측이 조용히 죽는다.

키가 비어 있으면 가드는 그냥 통과한다. 계측이 꺼진 번들이 나갈 뿐이라 안전한 상태다.

발행 절차 자체는 [`apps/api/src/main/resources/consent-docs/README.md`](../api/src/main/resources/consent-docs/README.md)가 정본이다.

### 환경 변수

| 변수 | 위치 | 값 |
| --- | --- | --- |
| `AMPLITUDE_API_KEY_WEB` | GitHub Actions **Environment 변수** (dev / prod 각각) | 환경별로 **다른** Amplitude 프로젝트 키 |
| `NEXT_PUBLIC_AMPLITUDE_API_KEY` | 빌드 시점 주입 (`deploy.yml`이 위 값을 넣는다) | — |
| `NEXT_PUBLIC_AMPLITUDE_API_KEY` | 로컬 `apps/web/.env.local` | 확인용. `.env*`는 커밋되지 않는다 |

**Amplitude 프로젝트를 두 개 만들어야 한다.** §1(4)대로 호스트로 거르지 않으므로, dev와 운영에 같은 키를 주면 개발 트래픽이 운영 통계에 그대로 섞인다. Repository 변수가 아니라 **Environment 변수**로 넣어야 환경별로 갈린다.

### 무료 한도 — 세션 리플레이가 먼저 막힌다

| 항목 | 무료 한도 | 지금 설정에서 소진되는 속도 |
| --- | --- | --- |
| 세션 리플레이 | 10,000 replay/월 | 100% 로 두면 **모든 세션이 녹화된다. 월 1만 세션에서 한도 도달** (단, 실제 비율은 코드가 아니라 **서버 원격 설정**이 정한다 — 위 ⚠️ 참고) |
| 이벤트 | 2,000,000 건/월 | autocapture 포함 세션당 대략 30~60건 → 월 3~6만 세션 수준 |

**리플레이가 이벤트보다 4배 먼저 막힌다.** 넘길 것 같으면 `sampleRate`를 낮춘다(`amplitude.ts`의 `initAll` 옵션). 0.1이면 10만 세션까지 버티고, 재현 가능한 표본으로는 대개 충분하다.

#### 세션이 무엇인지부터 — 연습 1회도, 사람 1명도 아니다

Amplitude의 세션은 **브라우저 활동 구간**이다. 30분 무활동이면 끊기고 다시 움직이면 새 세션이 된다. 1·2·3층을 다 도는 것과는 무관하다.

- 들어와서 아무것도 안 하고 나가도 1세션
- 연습 한 번을 쭉 이어서 하면 보통 1세션 (분석 대기가 길어도 폴링이 활동으로 잡힌다)
- **분석이 250초 걸려 폰을 놓고 30분 뒤 돌아와 노트를 보면 2세션**
- 한 사람이 한 달에 세 번 오면 3세션

#### 지금 규모에서는 한참 여유다 (2026-08-11 계산)

**동의 게이트가 익명 방문자를 통째로 걸러낸다.** Amplitude는 로그인 + 최신 방침 동의를 통과한 뒤에만 init되므로, 랜딩만 보고 나가는 사람은 세션을 만들지 않는다. SOMA-332 기준 최근 30일 광고 링크 클릭이 **3,205건**인데 거의 다 익명 유입이라 리플레이를 한 건도 쓰지 않는다. (SOMA-331이 "코어 GA가 로그인·동의 뒤에만 켜져서 그 이전 유입을 못 센다"고 지적한 것과 같은 구조다 — 귀속에는 불리하고 쿼터에는 유리하다.)

가입자는 **175명**(SOMA-279, 2026-08-03 기준, `ADMIN_OPS_EXCLUDE_EMAILS`로 개발자 제외된 값). 전원이 매달 10번씩 들어와도 **1,750세션 = 한도의 17%**다. 그래서 `sampleRate: 1`을 그대로 둔다.

**다시 계산해야 하는 때는 둘이다.**
1. **동의 게이트를 풀면** 즉시 위험해진다 — 익명 방문자가 세션을 만들기 시작하면 위 3,205건이 그대로 리플레이가 된다. 게이트는 방침 때문에 두는 것이지만 쿼터 방어도 겸하고 있다.
2. **가입이 10배 나면**(1,750명 규모) 여유가 사라진다. 그때 `sampleRate`를 0.2~0.3으로 낮추면 표본으로는 충분하다.

### 성능

세션 리플레이는 DOM 변화를 계속 기록한다. 이 앱은 화면에서 연습 영상을 재생하므로 부담이 큰 축이다 — 2026-08-11 로컬 검증 중 리플레이가 켜진 탭에서 렌더러가 멈춘 적이 있다(검증용 후크가 함께 걸려 있어 리플레이 단독 탓으로 단정하지는 못한다). **운영에 켠 뒤 실제 기기에서 연습 화면의 반응성을 한 번 봐야 한다.** 무거우면 `sampleRate`를 먼저 낮춘다.
