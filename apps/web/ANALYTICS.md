# 웹 계측 (Cloudflare · GA4 · PostHog)

세 도구를 **역할을 나눠** 쓴다. 하나로 합치지 않는다.

| 도구 | 답하는 질문 | 코드 |
| --- | --- | --- |
| **Cloudflare Web Analytics** | 랜딩 대비 다운로드 배지를 얼마나 눌렀나 | 프록시 자동 비컨과 `/go/<os>/<surface>` |
| **GA4** | 어느 채널·캠페인이 방문과 가입을 만들었나 | `src/lib/analytics/ga.ts` |
| **PostHog** | 들어온 사람이 제품 안에서 무엇을 하고 어디서 멈추나 | `src/lib/analytics/posthog.ts` |

GA4는 유입용 서브프로젝트 6개(voice·acti·stage·mono·pick·link)가 같은 측정 ID를 공유하므로 **빼지 않는다.** PostHog로 대체하려 들면 채널 귀속이 깨진다.

다운로드 배지는 스토어로 바로 가지 않고 `/go/<os>/<surface>`를 거친다. Cloudflare가 이
페이지로드를 경로별로 집계하므로 **배지 클릭 수와 랜딩 대비 비율은 Cloudflare에서 본다.**
`/go`에서는 개인정보나 별도 이벤트 payload를 수집하지 않고 경로별 페이지로드만 센다. 이
경로 집계는 아래 GA4·PostHog의 동의 게이트와 별개다.
랜딩은 `landing_*`, 앱 안내는 `app_page`, 검색 유입 안내는 `keyword_page` surface로 구분한다.

Cloudflare 무료 플랜은 쿼리(UTM)와 존 리퍼러를 집계하지 못한다(2026-10-09 실측). 그래서 링크에
`utm_source`가 있으면 `/go/<os>/<surface>/<source>`처럼 **출처 칸**을 하나 더 붙여 경로로 센다
(`store-links.ts`의 `storeLinkSource`). 출처 칸은 `STORE_LINK_SOURCE_BASES`의 정해진 이름만 쓰고
목록 밖 값은 `other`다. `utm_medium`이 유료 매체(`paid_social`·`cpc` 등)일 때만 `_ad`를 붙인다.
`utm_source`가 없으면 칸을 붙이지 않는다. 스토어로 넘기는 UTM 쿼리 규칙은 아래와 같다.

팀 브라우저는 `?acttub_team=1`로 한 번 열면 그 기기의 Cloudflare 비컨(`/cdn-cgi/rum`) 전송만
막는다(`lib/analytics/team-beacon-guard.ts`, `?acttub_team=0`으로 해제). 비컨은 프록시가 자동으로
넣으므로 사람별로 끌 방법이 이것뿐이다. 표시는 localStorage 한 칸이고 어디로도 보내지 않는다.

### 다운로드 캠페인 전달

현재 주소의 수동 태깅 UTM 6종(`utm_source`, `utm_medium`, `utm_campaign`, `utm_id`,
`utm_term`, `utm_content`)만 `/app`과 `/go`를 지나 Google Play Install Referrer까지 전달한다.
각 값은 영문자·숫자·점·밑줄·하이픈으로 된 1~64자 캠페인 토큰만 허용한다. `fbclid`, `gclid`,
세션 id와 그 밖의 임의 쿼리는 전달하지 않는다. 이 값은 **다운로드 링크를 만드는 경로에서는** 현재 URL에서만 읽으며 localStorage,
sessionStorage, cookie에 저장하지 않는다. 아래 운영 유입 저장은 별도 경로이며 privacy 동의 뒤
같은 신규 게스트에 묶인 실패 재시도 상태만 sessionStorage에 잠깐 둔다.

유효한 값이 없으면 기존 귀속인 `utm_source=acttub_web`, `utm_medium=<surface>`를 쓴다.
`utm_source=instagram`만으로 광고라고 추정하지 않는다. **인스타그램 유료 광고는 원래 URL에
`utm_medium=paid_social`이 명시된 경우에만** 그렇게 분류할 수 있다. `document.referrer`는
유료 여부 판단에 쓰지 않는다.

App Store 주소는 그대로다. Apple 제공자 토큰(`pt`)을 확인하지 않았으므로 캠페인 토큰(`ct`)을
임의로 만들지 않고, iOS 설치 기여를 이 링크만으로 확인할 수 있다고 해석하지 않는다.
다운로드 관련 기존 이벤트에도 원문 쿼리, referrer, 클릭 식별자를 새 속성으로 싣지 않는다.

### 운영 유입 비교용 최초 웹 UTM

ops에서 실제 웹 유입별 가입을 비교하기 위해 `PUT /v2/me/web-attribution`에 최초 UTM을 한 번
저장한다. 서버가 `source=web_utm`, `platform=web`을 고정하고, 웹은 실제 최초 URL의 안전한
`utm_source`를 `channel`로, `utm_medium`·`utm_campaign`·`utm_content`·`utm_term`을 선택값으로
보낸다. 값 검증은 위 다운로드 캠페인과 같은 1~64자 ASCII 토큰 정책이다. `utm_id`는 내부
이동 URL과 스토어 전달에는 보존하지만 이 API 계약에는 보내지 않는다.

- `utm_source`가 없으면 아무것도 저장하지 않는다. 미태깅 방문을 direct나 광고 아님으로
  단정하지 않으며, referrer·`fbclid`·`gclid`로 보충하거나 과거 출처를 복원하지 않는다.
- 페이지 최초 진입 때 이미 게스트 토큰이 있으면 재방문이다. 이번 광고 UTM을 그 게스트의 과거
  가입 출처로 붙이지 않는다. 토큰이 없던 이번 문서에서 `guest-started`로 새로 생긴 user id와
  일치할 때만 후보를 이어 간다.
- privacy 동의 전에는 메모리에만 두고, `/practice/new`→`/home`과 같은 내부 이동에서는 안전
  UTM을 URL에 보존한다. 식별 가능한 저장소 기록이나 서버 전송은 없다.
- 서버가 현재 privacy 결정을 `granted`로 확인한 뒤에만 user id에 바인딩해 전송한다. 이때부터
  네트워크 실패 재시도에 필요한 최소 요청값과 user id만 현재 탭의 sessionStorage에 둘 수 있다.
  성공하면 저장 상태와 URL의 UTM을 지운다.
- 동의 취소·조회 오류·API 오류 중에는 새로 전송하지 않는다. 게스트 종료, 다른 탭의 게스트
  시작·종료, user id 불일치에는 진행 요청을 취소하고 후보·저장 상태·URL UTM을 폐기한다.
  같은 게스트의 토큰 회전(값→값)은 계정 경계로 보지 않는다.
- API 호출은 공용 v2 클라이언트를 쓰되 `startGuest:false`, `consentPrompt:false`다. 귀속 저장을
  위해 게스트나 동의 시트를 만들지 않는다. reload 재시도는 동의 뒤 같은 user id에 묶어 둔
  현재 탭의 pending 상태만 복원한다.

---

## 1. 지켜야 하는 것

`ga.ts` 첫 주석의 원칙이 PostHog에도 **그대로** 적용된다. 하나라도 풀면 개인정보처리방침과 어긋난다.

### (1) GA4·PostHog는 동의 전에는 아무것도 저장하지 않는다

GA4는 `consent: denied` 상태에서 쿠키 없이 히트를 보내지만, **PostHog는 동의 전에는 초기화 자체를 하지 않는다.** 조건은 GA4와 동일하고 하나뿐이다(SOMA-528 결정 I-6, `src/features/consent/analytics-consent.ts`).

> **단일 기준은 서버다.** 이 브라우저에 게스트 토큰이 있고, `GET /v2/consents/entry`의 `privacy` 종류 행이 `current_decision === "granted"`일 때만 켠다.

- 웹에는 로그인이 없다(account.guest). 게스트는 처음 보호 기능을 쓰려 할 때 생기고, 동의는 기능 안의 시트(`src/features/consent/consent-sheet.tsx`)에서 받는다. `entry`는 **현재 판**에 대한 결정을 주므로, 새 판이 나오면 그 행이 미결정으로 돌아가 저절로 꺼진다 — 옛 판에만 동의한 사람에게 새 판의 수집을 적용하지 않는다.
- **닫힌 쪽으로 실패한다.** 게스트 토큰이 없거나(랜딩만 본 방문자 — 서버에 묻지도 않고, 이 조회 때문에 게스트가 생기지도 않는다), 행이 없거나, 값이 `granted`가 아니거나(`declined`·`revoked`·미결정), 조회가 실패하면 끈다. **조회 중에도 꺼진 상태다.**
- **판 번호를 코드에 박지 않고, 계측 판단을 `localStorage`에 복제하지도 않는다.** 예전의 `EXPECTED_PRIVACY_VERSION` 상수와 `accepted_privacy_version` 기록은 없다. 브라우저에 남기는 것은 나이 확인 하나뿐이고 계측과 무관하다.
- **서버에 묻는 때는 셋이다** — 앱을 시작할 때 한 번, 탭이 다시 보일 때(`visibilitychange`), 동의 제출 직후. 화면을 옮길 때마다 묻지 않는다.
- **즉시 끄는 때** — 어떤 요청이든 403 `consent_required`를 받아 시트가 열리는 순간(제출 완료를 기다리지 않는다), 게스트가 끝나는 순간(갱신 거절·`account_deactivated`), 새 게스트가 시작되는 순간. 진행 중이던 조회의 답은 버린다. 시트를 닫기만 해도 다시 묻는다 — 빠진 것이 `privacy`가 아니었다면 서버의 답은 여전히 `granted`다.
- **다른 탭에서 일어난 게스트의 끝·시작도 즉시 끄는 때다. 묻는 때가 아니다.** 그 변화는 `storage` 이벤트로만 오고(`watchGuestSession`), 게스트 토큰 키가 지워지거나 새로 생긴 것만 본다. 같은 게스트의 토큰 회전(값 → 값)과 다른 키의 쓰기는 지나친다 — 다른 탭의 SDK가 이벤트마다 `localStorage`를 쓰므로, 키를 거르지 않으면 그때마다 끄고 다시 묻게 된다. 꺼진 탭은 다시 보일 때 묻는다.
- **끈다는 것은 실제 중단이다.** GA4는 `analytics_storage: denied`로 되돌리고 `user_id`를 지운다(`revokeAnalyticsConsent`). PostHog는 `opt_out_capturing()`이다(`stopPostHog`) — 식별자만 지우면 이미 켜진 autocapture와 화면 녹화는 SDK가 스스로 계속 보낸다. opt-out 상태에서는 SDK의 `capture`가 이벤트를 버리고(돌던 녹화의 `$snapshot`도 `capture`를 거친다), 새 녹화는 시작하지 않는다(posthog-js 1.434.14 `session-recording.js`의 `isDisabled = … || consent.isOptedOut()`로 확인). 다시 켤 때는 `opt_in_capturing({ captureEventName: false })`로 푼다. `opt_in_capturing`이 녹화를 다시 시작하고(`sessionRecording.startIfEnabledOrStop()`), `captureEventName: false`는 기본으로 붙는 `$opt_in` 이벤트를 막는다.
- **opt-out은 브라우저에 남는다**(`opt_out_capturing_persistence_type` 기본 localStorage). 끈 채 새로고침하면 SDK가 꺼진 채로 init되므로, `startPostHog`는 켤 차례마다 `has_opted_out_capturing()`을 보고 푼다. `reset()`도 저장된 동의를 지우므로 순서는 `reset` → (필요하면) opt-in → `identify`다.
- 기기 식별(`posthog.reset(true)` — distinct id와 device id를 새로 만든다)은 끌 때마다 끊지 않는다. 탭이 다시 보일 때마다 확인하느라 잠깐 끄는 것까지 새 기기로 세면 같은 게스트가 여럿으로 갈린다. **다른 게스트로 켜질 때** 끊는다(`setPostHogUser`). 앞 게스트는 SDK가 저장해 둔 `$user_id`로 알아본다 — 모듈 변수로 비교하면 새로고침 뒤 첫 게스트 교체를 놓쳐 앞 게스트와 같은 device id로 이어진다(2026-10-11 실제 빌드에서 재현).

이 규칙은 `tests/analytics-consent.test.mjs`(granted → 켬 / declined·revoked·행 없음 → 끔 / 토큰 없음 → 끔 / 조회 실패 → 끔 / 켜진 뒤 403 → 즉시 끔 / 재조회로 어긋남 발견 → 끔), `tests/analytics-cross-tab.test.mjs`(다른 탭의 무관한 키·토큰 회전 → 묻지도 끄지도 않음 / 다른 탭의 게스트 끝·시작 → 묻지 않고 끔 / 탭이 다시 보임 → 물음), `tests/analytics-posthog.test.mjs`의 "계측 I-6"·새로고침 항목들이 고정한다.

동의 전에 쌓인 이벤트는 **버린다.** 큐에 모았다가 동의 후 흘려보내지 않는다. 그렇게 하면 "동의 전에는 수집하지 않는다"는 약속이 "동의 전에는 전송하지 않는다"로 슬쩍 바뀐다.

### (2) autocapture와 화면 녹화가 켜져 있고, 입력값을 가리지 않는다

옵션은 [posthog.ts](src/lib/analytics/posthog.ts)의 `posthog.init` 호출이 정본이다. 요점:

- `autocapture: true`, `capture_pageview: "history_change"` — 클릭과 전체 주소 페이지뷰를 SDK가 스스로 보낸다.
- `session_recording: { maskAllInputs: false }` — 화면 녹화가 입력값을 그대로 담는다. 비밀번호 칸은 SDK가 늘 가린다
  (posthog-js 1.434.14 `lazy-loaded-session-recorder.js`가 `maskInputOptions`에 `password: true`를 항상 붙인다).
  코드의 `maskAllInputs`가 프로젝트 설정의 마스킹보다 먼저 적용된다.
- 쓰지 않는 기능은 끈다 — 설문·제품 투어·대화(`disable_surveys`·`disable_product_tours`·`disable_conversations`),
  기능 플래그(`advanced_disable_feature_flags`), 오류 수집(`capture_exceptions: false`, 오류는 Sentry), 히트맵·죽은 클릭
  (`capture_heatmaps`·`capture_dead_clicks: false`). 처리방침에 고지한 수집 경로가 아니다. `disable_web_experiments`는
  기본값이 이미 true다. `advanced_disable_flags`는 켜지 않는다 — 녹화를 켜는 원격 설정까지 막힌다.

**2026-08-11 최우영 결정으로 자동 수집과 화면 녹화를 전부 켰다.** 그래서 아래가 PostHog로 나간다 — 방침이 이걸 전부 고지해야 하고, 이 목록이 곧 방침 6항의 수집 항목이다:

- **전체 주소** — 페이지뷰가 `location.href`를 통째로 싣는다: `/practice/history?session=<uuid>`, `/home?session=<uuid>`
- **클릭한 요소의 텍스트** — 좌측 레일 항목 제목에는 **사용자가 직접 쓴 상황 텍스트**가 들어간다(`practice-groups.ts`의 `groupTitle`).
- **화면 녹화** — 연습 영상이 재생되는 화면, 장면 3칸, 코치 대화 전문, 연습 노트, **입력 중인 값**이 전부 들어간다.

수동으로 쏘는 20개 이벤트는 그대로 §1(7)의 화이트리스트를 지킨다. 자동 수집을 켰다고 **우리가 만드는 payload까지 느슨해지지는 않는다** — 두 경로는 별개다.

⚠️ **입력값 마스킹은 일부러 껐다(사용자 결정).** 옛 기록: Amplitude 때는 마스킹을 따로 설정하지 않았지만 리플레이 SDK의
기본 마스킹 수준이 `medium`이라 폼 입력값은 전부 가려지고 화면 글자는 담겼다(@amplitude/session-replay-browser 1.48.1
`config/types.js`의 `DEFAULT_MASK_LEVEL`, 2026-10-11 소스로 확인). PostHog로 옮기면서 입력값도 그대로 녹화하므로
**이전보다 덜 가린다.** 비밀번호 칸만 SDK가 가린다.

#### 번들러 변경 검증

녹화 코드는 우리 번들에 들어가지 않는다. SDK가 녹화를 시작할 때 레코더 스크립트
(2026-10-11 운영 프로젝트에서 받은 것은 `https://us-assets.i.posthog.com/static/1.434.14/posthog-recorder.js`, 이름은 원격 설정이 정한다)를
따로 받는다(posthog-js `external-scripts-loader.js`·`request-router.js`). 그래서 번들러를 바꿀 때 볼 것은
"번들러가 녹화 청크를 깨뜨리는가"가 아니라 "SDK 번들이 레코더를 받아 실행하고 업로드하는가"다.

옛 기록: Amplitude 때는 리플레이 SDK가 동적 import로 불러오는 rrweb 레코더 청크가 2026-08-11 Turbopack 빌드에서
`SyntaxError`로 깨져 녹화가 조용히 0건이었다. 그래서 [package.json](package.json)의 `build`가 webpack(`--webpack`)을 쓴다.
PostHog에서는 이 갈래가 다르지만, 번들러를 바꾸면 아래 런타임 검증을 다시 한다. 빌드 성공과 이벤트 수신만으로는
녹화가 도는지 알 수 없다.

**완료 기준:** 변경한 번들러의 배포 빌드를 현재 판에 동의한 게스트·계측 키가 갖춰진 환경에서
실행했다. PostHog 프로젝트 설정에서 Session replay가 켜져 있는지 확인하고, 레코더 스크립트(`posthog-recorder.js`)
로드 성공과 `/s/` 업로드 성공을 네트워크 탭에서 확인했다. 콘솔 오류와 검증 환경을 함께 기록한다.

#### ⚠️ 녹화를 켜는 곳은 코드가 아니라 프로젝트 설정이다

SDK는 기동할 때 원격 설정(`https://us-assets.i.posthog.com/array/<key>/config`)을 받아 녹화 여부를 정한다.
**PostHog 프로젝트 설정의 Session replay 켜짐·샘플 비율이 실제 적용값이다.** 녹화가 안 보이면 코드를
고치기 전에 프로젝트 설정을 먼저 본다. 원격 설정을 못 받으면 녹화는 시작하지 않는다.

옛 기록: Amplitude 때도 코드의 `sampleRate: 1`이 원격 설정 1%에 덮여 2026-08-11 리플레이가 하나도 안 잡힌 적이 있다.

화면 전환은 autocapture와 별개로 `screen_viewed`도 직접 쏜다 — 이쪽은 주소가 씻긴 값이라 퍼널의 시작점으로 쓸 수 있다.

### (3) 주소는 경로만, UUID는 가린다

`scrubUrl()`(`src/lib/observability/sentry-shared.ts`)을 재사용한다 — 쿼리·해시를 떼고 경로의 UUID를 `<id>`로 치환한다. 허용 목록이 아니라 제거 방식이라 **새 쿼리가 생겨도 자동으로 걸러진다.** GA4의 `toTrackedQuery`는 캠페인 파라미터를 남겨야 해서 허용 목록을 쓰지만, PostHog 이벤트는 캠페인을 볼 필요가 없으므로 더 강한 쪽을 쓴다.

### (4) 환경은 호스트가 아니라 키로 나눈다

GA4는 `isMeasuredHost()`로 로컬과 `dev.acttub.com`(그 하위 포함) 트래픽을 막지만 — dev와 운영이 같은 측정 ID라 호스트로만 가를 수 있다 — PostHog는 그 가드를 두지 않는다. **환경별로 다른 프로젝트 키를 주입해 통계를 나눈다** — Sentry가 `NEXT_PUBLIC_SENTRY_ENV`로 하는 것과 같은 방식이고, 이래야 로컬에서 설치를 확인할 수 있다. 키를 두는 곳은 [§5 「환경 변수」](#환경-변수)다.

### (5) 켜고 끄는 스위치는 프로젝트 키 하나다

`NEXT_PUBLIC_POSTHOG_KEY`가 비어 있으면 **아무 일도 일어나지 않는다.** Sentry의 `isSentryEnabled()`와 같은 패턴이다. 별도 feature flag를 만들지 않는다 — 스위치가 둘이면 어느 쪽이 껐는지 헷갈린다.

> ⚠️ 키를 넣는 순서는 [§5 「켜는 순서」](#켜는-순서--틀리면-되돌릴-수-없다)를 따른다.

### (6) `user_id`는 백엔드 내부 식별자만

`getStoredUser().id`만 쓴다. 웹에서는 이 브라우저의 게스트 id다. 이메일·표시 이름·소셜 sub는 넣지 않는다. 계측이 꺼질 때 GA4의 `user_id`를 지우고, 다른 게스트로 켜질 때 PostHog를 `reset(true)`한 뒤 `identify`한다(§1(1)).

### (7) 이벤트 속성은 화이트리스트다

**절대 싣지 않는 값** — 한 번 나가면 되돌릴 수 없다:

연습 세션 UUID · 업로드 intent id · 파일명 · 장면 3칸 텍스트(situation/character/goal) · 막힘 상세 텍스트 · 대화 입력과 응답 본문 · 노트 본문과 제목 · 표시 이름 · 이메일 · 입시 검색어 원문 · 원본 영상 길이(ms)와 파일 크기(byte)

숫자는 **버킷으로 뭉갠다.** 원본 밀리초·바이트는 특정 연습을 짚어내는 지문이 된다.

> 세션 id는 **중복 방지 열쇠로만** 쓴다 — `workspace-app.tsx`의 `countStepOnce` 패턴을 그대로 복사한다. 열쇠로 쓰되 전송하지 않는다.

---

## 2. 버킷

`ga.ts`의 `toDurationBucket`은 그대로 재사용하고, 나머지는 `posthog.ts`에 둔다.

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

`theory_choice`는 0.1.0에서 준비 화면의 이론 선택과 함께 사라졌다(SOMA-546). 옛 이벤트에 남은 값은 그대로 두고 새 이벤트는 이 속성을 만들지 않는다.


`error_code`는 회차 응답의 `job.failure_reason`을 웹이 옮긴 값([practice-view.ts](src/features/practice/practice-view.ts)의 `toErrorCode`, 값 목록은 `posthog.ts`의 `AnalysisErrorCode`)을 그대로 싣는다. 지금 화면은 이 값을 전혀 쓰지 않는다.

`reason_code`는 HTTP status 숫자 또는 `network`·`aborted` 같은 고정 문자열만. **에러 메시지 원문을 넣지 않는다** — 서버 메시지에 무엇이 실려 올지 보장할 수 없다.

`stage`의 `session_create`는 업로드가 **전부 끝난 뒤** 세션 생성에서 터진 실패다. `UploadError`가 아니라서 단계를 스스로 알리지 못하므로 `begin()`이 표시를 남긴다. 이걸 `preflight`와 한 칸에 묶으면 "영상이 문제였다"와 "서버가 거절했다"가 섞인다 — 후자는 실사용자 4명이 이탈했던 자리다(`a0a09bb1`에서 지운 `sessions.ts`의 `fillBlankScene` 주석).

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

`turn_count`는 **실측이 유일한 진실**이다. 코치 응답 상한([practice.coach 「규칙·제약」](../../docs/specs/practice/coach.md#규칙제약))은 마지막 자리일 뿐이고, 배우가 먼저 끝내거나 코치가 먼저 마무리하면 더 일찍 닫히므로 실제 턴 수는 세션마다 다르다.

`report_type`의 `blocked`는 대화를 시작했지만 노트를 만들 근거가 부족한 경우다.
판정은
[ReportEngine](../api/src/main/java/com/acttub/actingapi/feature/report/app/ReportEngine.java)의
`buildReportInput`이 모델 입력을 만들지 못할 때(`generateReport`가 `blockedReport`를 낼 때)다.

`practice_dialogue_turn_failed`는 `workspace-app.tsx:send`의 답장 실패 catch에서 발생한다.
화면에는 연결 실패 안내 말풍선이 표시되므로, 이 이벤트로 답장 실패를 대화 내용과 구분해 센다.

`ended_by`: `coach`(모델이 complete) \| `actor_closing`(배우의 종료 표현).

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

`practice_history_opened`의 `age_days_bucket`이 리텐션의 실질 지표다 — PostHog의 리텐션 차트가 "재방문"을 세는 것과 별개로, **지난 연습을 실제로 다시 열어보는지**가 이 제품에서 값이 있는 행동이다.

### D. 동의 — "들어오다 막히나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `consent_submitted` | 게스트의 기능별 동의 시트 제출 | `result`: `ok`\|`partial_fail` |

웹에는 로그인이 없어 `login_completed`·`login_failed`는 없앴다(SOMA-528). ⚠️ **`consent_submitted`의 `ok`는 계측이 켜진 직후의 첫 이벤트다.** `privacy` 동의가 저장되고 서버가 `granted`라고 답한 뒤에야 PostHog가 켜지므로 그 전의 이벤트(영상 고르기 등)는 남지 않고, 저장에 실패한 첫 시트의 `partial_fail`도 버려진다. §1(1)의 결과이지 버그가 아니다 — 소급 전송하지 않는다. `privacy`가 없는 두 번째 시트(예: AI 분석 동의만)는 이미 켜진 상태에서 잡힌다.

### E. 화면 — "무엇을 쓰나"

| 이벤트 | 언제 | 속성 |
| --- | --- | --- |
| `screen_viewed` | 라우트 변경 | `path` (`scrubUrl` 통과) |

`path`는 경로만 남고 UUID는 `<id>`로 치환된다. GA4의 `page_view`와 중복이지만, PostHog에서 퍼널·리텐션의 시작점으로 쓰려면 같은 프로젝트 안에 있어야 한다.

---

## 4. 늘릴 때

이벤트를 추가하려면 **이 문서의 표를 먼저 고친다.** 표에 없는 이벤트를 코드에서 직접 쏘지 않는다.

호출은 전부 `src/lib/analytics/posthog.ts` 안의 래퍼 함수로만 한다 — `ga.ts`의 "이 파일 밖에서 `gtag`를 직접 부르지 않는다"와 같은 규칙이다. 그래야 속성 화이트리스트를 한 곳에서 강제할 수 있고, 금지 키가 payload에 없다는 테스트도 한 곳만 보면 된다.

2차 후보(지금은 넣지 않음): 동의 시트를 닫고 나간 횟수, 입시 필터·외부 링크 이탈, 막힘 1·2단계 개별 선택과 되돌리기 횟수.

---

## 5. 운영

### 켜는 순서 — 틀리면 되돌릴 수 없다

**방침 발행이 먼저, 키 주입이 나중이다.** 순서와 그것을 막는 배포 가드([`deploy/consent-gate.sh`](../../deploy/consent-gate.sh)), 발행 절차는 [consent-docs 「계측 키와 고지의 순서」](../api/src/main/resources/consent-docs/README.md#계측-키와-고지의-순서)가 정본이다. 키가 비어 있으면 가드는 그냥 통과한다. 계측이 꺼진 번들이 나갈 뿐이라 안전한 상태다.

웹은 판 번호를 들지 않고 서버가 답한 현재 판의 결정만 보므로(§1(1)), 웹과 api의 배포 순서가 어긋나도 현재 판에 동의하지 않은 동안에는 꺼져 있을 뿐이다.

### 환경 변수

| 변수 | 위치 | 값 |
| --- | --- | --- |
| `POSTHOG_KEY_WEB` | GitHub Actions **Environment 변수** (dev / prod 각각) | 환경별로 **다른** PostHog 프로젝트 키 |
| `NEXT_PUBLIC_POSTHOG_KEY` | 빌드 시점 주입 (`deploy.yml`이 위 값을 넣는다) | — |
| `NEXT_PUBLIC_POSTHOG_KEY` | 로컬 `apps/web/.env.local` | 확인용. `.env*`는 커밋되지 않는다 |

**PostHog 프로젝트를 dev와 운영 둘로 나눈다.** §1(4)대로 호스트로 거르지 않으므로, dev와 운영에 같은 키를 주면 개발 트래픽이 운영 통계에 그대로 섞인다. 프로젝트를 하나만 쓸 수 있으면 dev의 변수를 비워 dev 계측을 끈다. Repository 변수가 아니라 **Environment 변수**로 넣어야 환경별로 갈린다.

### 한도 검토

PostHog 무료 한도(이벤트·녹화 수, 프로젝트 수)는 아직 확인하지 않았다. 키를 넣기 전에 PostHog 프로젝트의
Billing 화면에서 확인해 여기에 날짜와 함께 적는다. 녹화 비율은 코드가 아니라 프로젝트 설정의 Session replay
샘플 비율이 정한다(§1(2)).

#### 세션이 무엇인지부터 — 연습 1회도, 사람 1명도 아니다

PostHog의 세션은 **브라우저 활동 구간**이다. 30분 무활동이면 끊기고 다시 움직이면 새 세션이 되며, 한 세션은 24시간을 넘지 않는다(posthog-js `sessionid.js`의 기본값). 1·2·3층을 다 도는 것과는 무관하다.

- 들어와서 아무것도 안 하고 나가도 1세션
- 연습 한 번을 쭉 이어서 하면 보통 1세션
- **분석이 250초 걸려 폰을 놓고 30분 뒤 돌아와 노트를 보면 2세션**
- 한 사람이 한 달에 세 번 오면 3세션

#### 옛 기록: Amplitude 때의 규모 계산 (2026-08-11)

당시 Amplitude 무료 한도는 리플레이 10,000건/월, 이벤트 2,000,000건/월이었다.

**동의 게이트가 익명 방문자를 통째로 걸러낸다.** 계측은 서버가 게스트의 `privacy` 동의를 `granted`라고 답한 뒤에만 init되므로(당시에는 로그인 + 최신 방침 동의), 랜딩만 보고 나가는 사람은 세션을 만들지 않는다. SOMA-332 기준 최근 30일 광고 링크 클릭이 **3,205건**인데 거의 다 익명 유입이라 녹화를 한 건도 쓰지 않는다. (SOMA-331이 "코어 GA가 로그인·동의 뒤에만 켜져서 그 이전 유입을 못 센다"고 지적한 것과 같은 구조다 — 귀속에는 불리하고 쿼터에는 유리하다.)

가입자는 **175명**(SOMA-279, 2026-08-03 기준, `ADMIN_OPS_EXCLUDE_EMAILS`로 개발자 제외된 값). 전원이 매달 10번씩 들어와도 **1,750세션 = 당시 리플레이 한도의 17%**라는 계산이 당시 100% 녹화 유지의 근거였다.

**다시 계산해야 하는 때는 둘이다.** PostHog 한도를 확인한 뒤 같은 방식으로 다시 센다.
1. **동의 게이트를 풀면** 즉시 위험해진다 — 익명 방문자가 세션을 만들기 시작하면 위 3,205건이 그대로 녹화가 된다. 게이트는 방침 때문에 두는 것이지만 쿼터 방어도 겸하고 있다.
2. **가입이 10배 나면**(1,750명 규모) 여유가 사라진다. 그때 프로젝트 설정의 샘플 비율을 0.2~0.3으로 낮추면 표본으로는 충분하다.

### 성능

화면 녹화는 DOM 변화를 계속 기록한다. 이 앱은 화면에서 연습 영상을 재생하므로 부담이 큰 축이다 — 2026-08-11 로컬 검증 중 Amplitude 리플레이가 켜진 탭에서 렌더러가 멈춘 적이 있다(검증용 후크가 함께 걸려 있어 리플레이 단독 탓으로 단정하지는 못한다). **운영에 켠 뒤 실제 기기에서 연습 화면의 반응성을 한 번 봐야 한다.** 무거우면 프로젝트 설정의 샘플 비율을 먼저 낮춘다.
