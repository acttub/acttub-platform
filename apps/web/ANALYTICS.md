# 웹 계측 (Cloudflare · GA4 · Amplitude)

세 도구를 **역할을 나눠** 쓴다. 하나로 합치지 않는다.

| 도구 | 답하는 질문 | 코드 |
| --- | --- | --- |
| **Cloudflare Web Analytics** | 랜딩 대비 다운로드 배지를 얼마나 눌렀나 | 프록시 자동 비컨과 `/go/<os>/<surface>` |
| **GA4** | 어느 채널·캠페인이 방문과 가입을 만들었나 | `src/lib/analytics/ga.ts` |
| **Amplitude** | 들어온 사람이 제품 안에서 무엇을 하고 어디서 멈추나 | `src/lib/analytics/amplitude.ts` |

GA4는 유입용 서브프로젝트 6개(voice·acti·stage·mono·pick·link)가 같은 측정 ID를 공유하므로 **빼지 않는다.** Amplitude로 대체하려 들면 채널 귀속이 깨진다.

다운로드 배지는 스토어로 바로 가지 않고 `/go/<os>/<surface>`를 거친다. Cloudflare가 이
페이지로드를 경로별로 집계하므로 **배지 클릭 수와 랜딩 대비 비율은 Cloudflare에서 본다.**
`/go`에서는 개인정보나 별도 이벤트 payload를 수집하지 않고 경로별 페이지로드만 센다. 이
경로 집계는 아래 GA4·Amplitude의 동의 게이트와 별개다.
랜딩은 `landing_*`, 앱 안내는 `app_page`, 검색 유입 안내는 `keyword_page` surface로 구분한다.

---

## 1. 지켜야 하는 것

`ga.ts` 첫 주석의 원칙이 Amplitude에도 **그대로** 적용된다. 하나라도 풀면 개인정보처리방침과 어긋난다.

### (1) GA4·Amplitude는 동의 전에는 아무것도 저장하지 않는다

GA4는 `consent: denied` 상태에서 쿠키 없이 히트를 보내지만, **Amplitude는 동의 전에는 초기화 자체를 하지 않는다.** 조건은 GA4와 동일하고 하나뿐이다(SOMA-528 결정 I-6, `src/features/consent/analytics-consent.ts`).

> **단일 기준은 서버다.** 이 브라우저에 게스트 토큰이 있고, `GET /v2/consents/entry`의 `privacy` 종류 행이 `current_decision === "granted"`일 때만 켠다.

- 웹에는 로그인이 없다(account.guest). 게스트는 처음 보호 기능을 쓰려 할 때 생기고, 동의는 기능 안의 시트(`src/features/consent/consent-sheet.tsx`)에서 받는다. `entry`는 **현재 판**에 대한 결정을 주므로, 새 판이 나오면 그 행이 미결정으로 돌아가 저절로 꺼진다 — 옛 판에만 동의한 사람에게 새 판의 수집을 적용하지 않는다.
- **닫힌 쪽으로 실패한다.** 게스트 토큰이 없거나(랜딩만 본 방문자 — 서버에 묻지도 않고, 이 조회 때문에 게스트가 생기지도 않는다), 행이 없거나, 값이 `granted`가 아니거나(`declined`·`revoked`·미결정), 조회가 실패하면 끈다. **조회 중에도 꺼진 상태다.**
- **판 번호를 코드에 박지 않고, 계측 판단을 `localStorage`에 복제하지도 않는다.** 예전의 `EXPECTED_PRIVACY_VERSION` 상수와 `accepted_privacy_version` 기록은 없다. 브라우저에 남기는 것은 나이 확인 하나뿐이고 계측과 무관하다.
- **서버에 묻는 때는 셋이다** — 앱을 시작할 때 한 번, 탭이 다시 보일 때(`visibilitychange`), 동의 제출 직후. 화면을 옮길 때마다 묻지 않는다.
- **즉시 끄는 때** — 어떤 요청이든 403 `consent_required`를 받아 시트가 열리는 순간(제출 완료를 기다리지 않는다), 게스트가 끝나는 순간(갱신 거절·`account_deactivated`), 새 게스트가 시작되는 순간. 진행 중이던 조회의 답은 버린다. 시트를 닫기만 해도 다시 묻는다 — 빠진 것이 `privacy`가 아니었다면 서버의 답은 여전히 `granted`다.
- **다른 탭에서 일어난 게스트의 끝·시작도 즉시 끄는 때다. 묻는 때가 아니다.** 그 변화는 `storage` 이벤트로만 오고(`watchGuestSession`), 게스트 토큰 키가 지워지거나 새로 생긴 것만 본다. 같은 게스트의 토큰 회전(값 → 값)과 다른 키의 쓰기는 지나친다 — 다른 탭의 SDK가 이벤트마다 `localStorage`를 쓰므로, 키를 거르지 않으면 그때마다 끄고 다시 묻게 된다. 꺼진 탭은 다시 보일 때 묻는다.
- **끈다는 것은 실제 중단이다.** GA4는 `analytics_storage: denied`로 되돌리고 `user_id`를 지운다(`revokeAnalyticsConsent`). Amplitude는 `setOptOut(true)`다(`stopAmplitude`) — 식별자만 지우면 이미 켜진 autocapture와 세션 리플레이는 SDK가 스스로 계속 보낸다. opt-out은 그 뒤의 이벤트(autocapture 포함)를 버리고, 리플레이 플러그인은 opt-out을 받아 녹화를 `shutdown()`한다(`@amplitude/plugin-session-replay-browser` 1.33.7의 `onOptOutChanged`, 코어의 `setOptOut` → `timeline.onOptOutChanged`로 확인). 다시 켤 때는 `setOptOut(false)`로 풀고 플러그인이 녹화를 다시 시작한다.
- 기기 식별(`amplitude.reset()`)은 끌 때마다 끊지 않는다. 탭이 다시 보일 때마다 확인하느라 잠깐 끄는 것까지 새 기기로 세면 같은 게스트가 여럿으로 갈린다. **다른 게스트로 켜질 때** 끊는다(`setAmplitudeUser`).

이 규칙은 `tests/analytics-consent.test.mjs`(granted → 켬 / declined·revoked·행 없음 → 끔 / 토큰 없음 → 끔 / 조회 실패 → 끔 / 켜진 뒤 403 → 즉시 끔 / 재조회로 어긋남 발견 → 끔), `tests/analytics-cross-tab.test.mjs`(다른 탭의 무관한 키·토큰 회전 → 묻지도 끄지도 않음 / 다른 탭의 게스트 끝·시작 → 묻지 않고 끔 / 탭이 다시 보임 → 물음), `tests/analytics-amplitude.test.mjs`의 "계측 I-6" 항목들이 고정한다.

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

- **전체 주소** — autocapture 페이지뷰가 `location.href`를 통째로 싣는다: `/practice/history?session=<uuid>`, `/home?session=<uuid>`
- **클릭한 요소의 텍스트** — 좌측 레일 항목 제목은 **사용자가 직접 쓴 상황 텍스트**다(`workspace-app.tsx`의 `headlineBySession`).
- **화면 녹화 100%** — `sampleRate: 1`. 연습 영상이 재생되는 화면, 장면 3칸, 코치 대화 전문, 연습 노트가 전부 들어간다.

수동으로 쏘는 20개 이벤트는 그대로 §1(7)의 화이트리스트를 지킨다. 자동 수집을 켰다고 **우리가 만드는 payload까지 느슨해지지는 않는다** — 두 경로는 별개다.

⚠️ **마스킹은 설정하지 않았다.** Amplitude Session Replay는 텍스트·입력을 가리는 옵션을 따로 제공한다. 지금 설정은 받은 지침 그대로이고, 마스킹을 넣으려면 여기서부터 손대면 된다.

#### 번들러 변경 검증

[package.json](package.json)의 `build`는 세션 리플레이가 동작하는 번들러를 사용한다.
번들러를 바꿀 때는 아래 런타임 검증을 통과해야 한다. 빌드 성공과 이벤트 수신만으로는
녹화 청크가 실행되는지 알 수 없다.

2026-08-11 검증에서 리플레이 SDK가 **동적 import**로 불러오는 rrweb 레코더 청크
(`getRecordFunction`)가 Turbopack 빌드에서 `SyntaxError: Invalid or unexpected token`으로
실패했다. SDK가 예외를 삼키고 null을 돌려주어 녹화가 시작되지 않았다:

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

**완료 기준:** 변경한 번들러의 배포 빌드를 현재 판에 동의한 게스트·계측 키가 갖춰진 환경에서
실행했다. 원격 설정의 캡처 활성화와 샘플 비율을 확인하고, 녹화 청크 로딩·리플레이 버퍼·
`sessions/v2/track` 업로드 성공을 확인했다. 콘솔 오류와 검증 환경을 함께 기록한다.

#### ⚠️ 코드의 `sampleRate` 는 서버 원격 설정에 덮인다

**`sessionReplayPlugin`에 넣은 `sampleRate`가 최종 값은 아니다.** SDK 는 기동할 때
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

`getStoredUser().id`만 쓴다. 웹에서는 이 브라우저의 게스트 id다. 이메일·표시 이름·소셜 sub는 넣지 않는다. 계측이 꺼질 때 GA4의 `user_id`를 지우고, 다른 게스트로 켜질 때 Amplitude를 `reset()`한다(§1(1)).

### (7) 이벤트 속성은 화이트리스트다

**절대 싣지 않는 값** — 한 번 나가면 되돌릴 수 없다:

연습 세션 UUID · 업로드 intent id · 파일명 · 장면 3칸 텍스트(situation/character/goal) · 막힘 상세 텍스트 · 대화 입력과 응답 본문 · 노트 본문과 제목 · 표시 이름 · 이메일 · 입시 검색어 원문 · 원본 영상 길이(ms)와 파일 크기(byte)

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

## 3. 이벤트 사전 (1차 20개)

이벤트를 더 늘리기 전에 **이 20개로 답이 나오는지 먼저 본다.** 입시 계측은 2차로 미룬다 — 지금 답해야 할 질문(퍼널 이탈·리텐션·대화 품질)에 필요 없다.

> **설치 검증용 임시 이벤트가 따로 있다.** `Viewed Home Page` — `startAmplitude()`의
> `amplitude.init` 바로 뒤에서 발생한다. 실제 payload는
> [amplitude.ts](src/lib/analytics/amplitude.ts)의 호출부에서 확인한다. Amplitude Setup 페이지의
> 라이브 피드에서 수신을 확인한 뒤 제거한다. 제품 질문에 답하는 이벤트가 아니다.

### A. 연습 퍼널 — "어디서 나가나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `practice_prep_opened` | prep 모드 진입 | `entry`: `new` \| `reset` |
| `practice_video_selected` | 파일 선택 완료 | `size_bucket`, `is_reselect` |
| `practice_blockage_submitted` | 도움을 실제로 고른 채 시작 | `kind`, `sub_branch`, `has_detail` |
| `practice_upload_failed` | 업로드·세션 생성 실패 | `stage`: `preflight`\|`intent`\|`put`\|`complete`\|`session_create`, `reason_code` |
| `practice_session_created` | 회차 생성 성공 | `duration_bucket`, `kind`, `sub_branch`, `scene_skipped` |
| `practice_analysis_settled` | 분석 종료 | `result`: `analyzed`\|`failed`, `error_code`, `wait_bucket` |

`practice_blockage_submitted`는 도움 갈래를 실제로 고른 사람만 세며, 자동으로 채우는 `그 외` 기본값은 포함하지 않는다. 업로드는 준비 화면의 시작 버튼을 누른 뒤 바로 시작하고, 실패는 같은 진행 자리에서 안내한다.

`theory_choice`는 1.0.0에서 준비 화면의 이론 선택과 함께 사라졌다(SOMA-546). 옛 이벤트에 남은 값은 그대로 두고 새 이벤트는 이 속성을 만들지 않는다.


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

`report_type`의 `blocked`는 대화를 시작했지만 노트를 만들 실질 답변이 부족한 경우다.
답변 판정과 최소 개수는
[HandoffReadiness](../api/src/main/java/com/acttub/actingapi/feature/coach/domain/HandoffReadiness.java)의
`hasEnoughAnswers`·`MIN_ANSWERS_FOR_REPORT`에서 확인한다.

`practice_dialogue_turn_failed`는 `workspace-app.tsx:send`의 답장 실패 catch에서 발생한다.
화면에는 연결 실패 안내 말풍선이 표시되므로, 이 이벤트로 답장 실패를 대화 내용과 구분해 센다.

`ended_by`: `coach`(모델이 complete) \| `actor_closing`("그만"·"종료"·"끝"·"여기까지").

`actor_closing`은 프론트의 `workspace-app.tsx:isActorClosing`이 추정한다. 응답에 종료 사유가
없어 백엔드 [ClosingIntent](../api/src/main/java/com/acttub/actingapi/feature/coach/domain/ClosingIntent.java)의
`isClosing`과 별도로 판정하므로, 백엔드 규칙이 바뀌면 둘을 대조한다. `ended_by`는 참고값이며,
`turn_count`·`report_type`은 서버 응답에서 직접 온다.

### C. 이탈과 재방문 — "다시 오나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `practice_abandoned` | preparing·chat 상태로 화면 이탈 | `mode`, `turn_count`, `pct_bucket` |
| `practice_history_opened` | 좌측 레일에서 지난 연습 열기 | `status`, `has_note`, `age_days_bucket` |
| `exit_review_opened` | 후기 창 열림 | `trigger`: `x`\|`leave`\|`back`, `mode` |
| `exit_review_submitted` | 후기 제출 | `trigger` |

`practice_history_opened`의 `age_days_bucket`이 리텐션의 실질 지표다 — Amplitude의 리텐션 차트가 "재방문"을 세는 것과 별개로, **지난 연습을 실제로 다시 열어보는지**가 이 제품에서 값이 있는 행동이다.

### D. 동의 — "들어오다 막히나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `consent_submitted` | 게스트의 기능별 동의 시트 제출 | `result`: `ok`\|`partial_fail` |

웹에는 로그인이 없어 `login_completed`·`login_failed`는 없앴다(SOMA-528). ⚠️ **`consent_submitted`의 `ok`는 계측이 켜진 직후의 첫 이벤트다.** `privacy` 동의가 저장되고 서버가 `granted`라고 답한 뒤에야 Amplitude가 켜지므로 그 전의 이벤트(영상 고르기 등)는 남지 않고, 저장에 실패한 첫 시트의 `partial_fail`도 버려진다. §1(1)의 결과이지 버그가 아니다 — 소급 전송하지 않는다. `privacy`가 없는 두 번째 시트(예: AI 분석 동의만)는 이미 켜진 상태에서 잡힌다.

### E. 화면 — "무엇을 쓰나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `screen_viewed` | 라우트 변경 | `path` (`scrubUrl` 통과) |

`path`는 경로만 남고 UUID는 `<id>`로 치환된다. GA4의 `page_view`와 중복이지만, Amplitude에서 퍼널·리텐션의 시작점으로 쓰려면 같은 프로젝트 안에 있어야 한다.

---

## 4. 늘릴 때

이벤트를 추가하려면 **이 문서의 표를 먼저 고친다.** 표에 없는 이벤트를 코드에서 직접 쏘지 않는다.

호출은 전부 `src/lib/analytics/amplitude.ts` 안의 래퍼 함수로만 한다 — `ga.ts`의 "이 파일 밖에서 `gtag`를 직접 부르지 않는다"와 같은 규칙이다. 그래야 속성 화이트리스트를 한 곳에서 강제할 수 있고, 금지 키가 payload에 없다는 테스트도 한 곳만 보면 된다.

2차 후보(지금은 넣지 않음): 동의 시트를 닫고 나간 횟수, 입시 필터·외부 링크 이탈, 막힘 1·2단계 개별 선택과 되돌리기 횟수.

---

## 5. 운영

### 켜는 순서 — 틀리면 되돌릴 수 없다

**방침 발행이 먼저, 키 주입이 나중이다.** 순서가 바뀌면 고지 없이 이용 기록과 화면 녹화가 수탁사로 넘어가고, 이미 전송된 것은 되돌릴 수 없다.

이건 기억에 맡기지 않는다 — `deploy.yml`이 부르는 `deploy/consent-gate.sh`의 **`계측 키가 방침 고지보다 앞서지 않는지`** 가드가 막는다. 키가 설정돼 있는데 발행 중인 문서에 `Amplitude` 위탁 고지가 없으면 **배포가 실패한다.**

이 가드는 예전에 웹의 `EXPECTED_PRIVACY_VERSION` 상수가 manifest의 발행 판과 같은지도 대조했다. 그 상수는 없앴고(§1(1)), 그것이 지키던 것 — 옛 판 동의자에게 새 수집을 적용하지 않는다 — 은 이제 웹이 실행 중에 서버의 동의 현황을 물어 지킨다. 그래서 웹과 api의 배포 순서가 어긋나도 현재 판에 동의하지 않은 동안에는 꺼져 있을 뿐이다.

키가 비어 있으면 가드는 그냥 통과한다. 계측이 꺼진 번들이 나갈 뿐이라 안전한 상태다.

발행 절차 자체는 [`apps/api/src/main/resources/consent-docs/README.md`](../api/src/main/resources/consent-docs/README.md)가 정본이다.

### 환경 변수

| 변수 | 위치 | 값 |
| --- | --- | --- |
| `AMPLITUDE_API_KEY_WEB` | GitHub Actions **Environment 변수** (dev / prod 각각) | 환경별로 **다른** Amplitude 프로젝트 키 |
| `NEXT_PUBLIC_AMPLITUDE_API_KEY` | 빌드 시점 주입 (`deploy.yml`이 위 값을 넣는다) | — |
| `NEXT_PUBLIC_AMPLITUDE_API_KEY` | 로컬 `apps/web/.env.local` | 확인용. `.env*`는 커밋되지 않는다 |

**Amplitude 프로젝트를 두 개 만들어야 한다.** §1(4)대로 호스트로 거르지 않으므로, dev와 운영에 같은 키를 주면 개발 트래픽이 운영 통계에 그대로 섞인다. Repository 변수가 아니라 **Environment 변수**로 넣어야 환경별로 갈린다.

### 한도 검토

아래 수치와 규모 계산은 2026-08-11 당시 기록이다. 샘플 비율을 바꾸기 전에는 Amplitude
프로젝트의 현재 요금제·사용량·원격 샘플 설정을 확인하고 실제 세션 수로 다시 계산한다.

| 항목 | 당시 무료 한도 | 당시 설정에서 예상한 소진 속도 |
| --- | --- | --- |
| 세션 리플레이 | 10,000 replay/월 | 100% 로 두면 **모든 세션이 녹화된다. 월 1만 세션에서 한도 도달** (단, 실제 비율은 코드가 아니라 **서버 원격 설정**이 정한다 — 위 ⚠️ 참고) |
| 이벤트 | 2,000,000 건/월 | autocapture 포함 세션당 대략 30~60건 → 월 3~6만 세션 수준 |

이 계산에서는 리플레이가 이벤트보다 먼저 한도에 닿는다. 비율을 조정할 때는
`amplitude.ts`의 `sessionReplayPlugin` 옵션과 §1(2)의 서버 원격 설정을 함께 확인한다.

#### 세션이 무엇인지부터 — 연습 1회도, 사람 1명도 아니다

Amplitude의 세션은 **브라우저 활동 구간**이다. 30분 무활동이면 끊기고 다시 움직이면 새 세션이 된다. 1·2·3층을 다 도는 것과는 무관하다.

- 들어와서 아무것도 안 하고 나가도 1세션
- 연습 한 번을 쭉 이어서 하면 보통 1세션 (분석 대기가 길어도 폴링이 활동으로 잡힌다)
- **분석이 250초 걸려 폰을 놓고 30분 뒤 돌아와 노트를 보면 2세션**
- 한 사람이 한 달에 세 번 오면 3세션

#### 당시 규모 계산 (2026-08-11)

**동의 게이트가 익명 방문자를 통째로 걸러낸다.** Amplitude는 서버가 게스트의 `privacy` 동의를 `granted`라고 답한 뒤에만 init되므로(당시에는 로그인 + 최신 방침 동의), 랜딩만 보고 나가는 사람은 세션을 만들지 않는다. SOMA-332 기준 최근 30일 광고 링크 클릭이 **3,205건**인데 거의 다 익명 유입이라 리플레이를 한 건도 쓰지 않는다. (SOMA-331이 "코어 GA가 로그인·동의 뒤에만 켜져서 그 이전 유입을 못 센다"고 지적한 것과 같은 구조다 — 귀속에는 불리하고 쿼터에는 유리하다.)

가입자는 **175명**(SOMA-279, 2026-08-03 기준, `ADMIN_OPS_EXCLUDE_EMAILS`로 개발자 제외된 값). 전원이 매달 10번씩 들어와도 **1,750세션 = 한도의 17%**라는 계산이 당시 `sampleRate: 1` 유지의 근거였다.

**다시 계산해야 하는 때는 둘이다.**
1. **동의 게이트를 풀면** 즉시 위험해진다 — 익명 방문자가 세션을 만들기 시작하면 위 3,205건이 그대로 리플레이가 된다. 게이트는 방침 때문에 두는 것이지만 쿼터 방어도 겸하고 있다.
2. **가입이 10배 나면**(1,750명 규모) 여유가 사라진다. 그때 `sampleRate`를 0.2~0.3으로 낮추면 표본으로는 충분하다.

### 성능

세션 리플레이는 DOM 변화를 계속 기록한다. 이 앱은 화면에서 연습 영상을 재생하므로 부담이 큰 축이다 — 2026-08-11 로컬 검증 중 리플레이가 켜진 탭에서 렌더러가 멈춘 적이 있다(검증용 후크가 함께 걸려 있어 리플레이 단독 탓으로 단정하지는 못한다). **운영에 켠 뒤 실제 기기에서 연습 화면의 반응성을 한 번 봐야 한다.** 무거우면 `sampleRate`를 먼저 낮춘다.
