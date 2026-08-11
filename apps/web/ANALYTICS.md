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

### (2) autocapture는 전부 끈다

```ts
amplitude.init(API_KEY, undefined, {
  autocapture: false,   // ← 통째로 끈다. 개별 플래그로 켜지 않는다.
  identityStorage: "localStorage",
  serverZone: "US",
})
```

Browser SDK 2.10+ 는 **기본이 켜짐**이다. 켜두면 두 가지가 새어 나간다:

- **페이지뷰**가 `location.href`를 통째로 싣는다 → `/practice/history?session=<uuid>`, `/community/post?id=<uuid>`, `/login?next=<경로>`
- **element interactions**가 클릭한 요소의 텍스트를 싣는다 → 좌측 레일 항목 제목은 **사용자가 직접 쓴 상황 텍스트**다(`workspace-app.tsx`의 `headlineBySession`). 커뮤니티 글 제목도 마찬가지다.

화면 전환은 `screen_viewed`로 **직접** 쏜다.

### (3) 주소는 경로만, UUID는 가린다

`scrubUrl()`(`src/lib/observability/sentry-shared.ts`)을 재사용한다 — 쿼리·해시를 떼고 경로의 UUID를 `<id>`로 치환한다. 허용 목록이 아니라 제거 방식이라 **새 쿼리가 생겨도 자동으로 걸러진다.** GA4의 `toTrackedQuery`는 캠페인 파라미터를 남겨야 해서 허용 목록을 쓰지만, Amplitude는 캠페인을 볼 필요가 없으므로 더 강한 쪽을 쓴다.

### (4) 실서비스 호스트에서만 돈다

`isMeasuredHost()`(`ga.ts`)를 재사용한다. dev 서버가 같은 빌드를 서빙하므로 가드가 없으면 개발 트래픽이 섞인다.

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
