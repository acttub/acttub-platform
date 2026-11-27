# app.ads 광고 칸

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-876 (게시판 칸 키는 SOMA-873 용으로 예약), 전면 칸 SOMA-1085, 보상형 광고 SOMA-1067
- 화면: 둘러보기 화면 위쪽 칸, 연습 중 기다리는 화면의 칸 (앱 안 광고 상세 화면은 없다 — 상세는 광고주 쪽 페이지)
- 테이블: ads, ad_events, coaching_rewards

## 기능
칸(slot)마다 서버가 띄울 것을 하나 고른다. 1) 광고주에게 직접 받은 광고(DIRECT — 연기학원·연극·극단 등) 2) 우리 앱 광고(HOUSE, 앱 안 경로로 이동)
3) AdMob 으로 채우기(NETWORK). 칸에 맞는 후보가 없으면 다음 단계로 넘어가고, 띄우지 않을 때는 NONE 이다.

## 노출 조건
- 첫 연습(노트가 생긴 코칭·끝까지 읽은 리딩·챌린지 참여)을 끝내기 전이면 모든 칸이 NONE 이다. 앱의 첫 사용자 홈과 같은 기준이다.
- Pro 는 어느 칸이든 NONE 이다(Pro 혜택 「광고 없음」, `AdPicker`). 그래서 대상이 pro 인 HOUSE 도 나가지 않는다.
- 연습 중 칸(PRACTICE)은 무료 사용자만, 그중 `ADS_PRACTICE_SLOT_PERCENT`(기본 100)% 에게 켠다. 기본값이면 전원이다. 배정은 사용자 id 해시로 고정한다.
- `ADS_ENABLED=false` 면 모든 칸이 NONE 이다.
- DIRECT 는 칸 규격의 이미지와 http(s) `link_url` 이 있어야 하고(없으면 건너뛴다), 누르면 `link_url` 을 앱 밖 브라우저로 바로 연다. 학원 전용 칸(등록번호·교습과정·교습비)은 쓰지 않는다(열은 남아 있다).  HOUSE 는 `/` 로 시작하는 앱 안 경로와 이미지 또는 headline 이 있어야 한다.
- 칸 하나만 끄려면 `ad_slot_switches`(V76)에서 그 칸을 `enabled=false` 로 둔다. 그 칸은 누구에게나 NONE 이라 직접·자체 광고도 AdMob 도 나오지 않는다. 줄이 없는 칸은 켜진 것이다. 앱 빌드 없이 다음 화면 진입부터 적용된다.
- 같은 단계 후보가 여럿이면 priority 가 가장 큰 것들 중 사람·칸·한국 날짜마다 하나로 고정해 돌린다.

## 전면 칸 (SOMA-1085)
화면 전체를 덮는 AdMob 전면 광고 자리다. 앱이 화면에 들어올 때 서버에 칸을 묻고, NETWORK 면 AdMob 전면 광고를 불러와 띄운다.
- 칸: `analyzing_wait_full`(코칭 영상 분석을 기다리기 시작할 때, 예시 영상 제외), `script_parse_full`(리딩 대본 나누기를 시작할 때),
  `reading_done_full`(리딩을 끝내고 결과로 넘어갈 때, 튜토리얼 제외 — 별점 묻기는 광고를 닫은 뒤).
- 서버는 이 칸에 NETWORK 아니면 NONE 만 준다(직접·자체 광고 없음). 첫 연습 전·Pro 는 NONE 이고, 연습 중 배너 A/B 비율은 따르지 않는다.
- **켜기**: 다른 칸과 달리 `ad_slot_switches` 에 `enabled=true` 줄을 넣어야 켜진다. 줄이 없으면 꺼짐이다.
  예: `INSERT INTO ad_slot_switches(slot_key, enabled) VALUES ('analyzing_wait_full', true), ('script_parse_full', true), ('reading_done_full', true);`
- 앱: 같은 사람에게 3분에 한 번까지(앱을 켜 둔 동안), 화면에 들어올 때 첫 사용자였으면 띄우지 않는다, AdMob 초기화 전이거나 4초 안에 못 불러오면
  광고 없이 지나간다(그 뒤에 불러와져도 띄우지 않는다). 나이별 요청 설정(청소년 비맞춤)은 배너와 같다.
- 광고 단위: dev·개발 빌드는 Google 테스트 전면 단위, 운영 빌드는 `PRODUCTION_INTERSTITIAL_UNITS` — 비어 있으면 운영 빌드는 띄우지 않는다.
- 건너뛰기 5초는 AdMob 설정으로 정한다: 앱 설정 「높은 참여도 광고」 끔(켜면 최대 12초), 계정 설정 「전면 광고의 건너뛸 수 없는 동영상」 끔
  (켜 두면 최대 30초 광고가 올 수 있다). 앱은 건너뛰기 시간을 정하지 못한다.

## 보상형 광고 (SOMA-1067)
무료 코칭 하루 한도(3회)를 다 쓴 무료 회원이 AdMob 보상형 광고를 끝까지 보면 그날 코칭 1회를 더 받는다.
- **켜기**: 서버 `COACHING_REWARDED_AD_ENABLED`(기본 false). 꺼져 있으면 버튼이 보이지 않고 한도 계산도 그대로다.
  하루(한국 시간) 상한은 `COACHING_REWARDED_AD_DAILY_LIMIT`(기본 1, 0 이하면 끔).
- **대상**: 무료 한도가 걸리는 회원([billing.subscription 「무료 한도」](../billing/subscription.md#무료-한도-billing_free_limits_enabled-기본-false))만이다.
  Pro·한도 꺼짐·기존 회원 유예·게스트에게는 보이지 않고 지급하지 않는다.
- **버튼**: 한도에 걸린 안내(「오늘 무료 코칭을 다 썼어요」) 안에 Pro 안내와 함께 「광고 보고 1회 더」가 보인다. 서버가 `available` 이라고
  할 때만이고(오늘 회차를 받은 보상분까지 다 썼고 상한이 남음), 앱 빌드에 보상형 광고 단위가 없으면 보이지 않는다.
- **흐름**: 앱이 1회용 요청 id 를 만들어 AdMob 서버 측 확인 옵션(`userId` = 회원 id, `customData` = 요청 id)과 함께 광고를 띄운다.
  끝까지 보면 AdMob 이 서버 콜백을 부르고, 서버는 Google 공개키로 서명을 확인한 뒤 `transaction_id` 하나에 한 번만 1회를 더한다.
  앱은 「확인하는 중」을 보이며 요청 id 로 약 10초까지 지급을 묻고, 확인되면 바로 코칭을 다시 시작할 수 있다. 광고가 오지 않거나
  중간에 닫거나 확인이 안 되면 짧은 안내만 보이고 횟수는 늘지 않는다.
- 광고 단위: dev·개발 빌드는 Google 테스트 보상형 단위, 운영 빌드는 `PRODUCTION_REWARDED_UNITS`(아직 비어 있음 — 운영 빌드는 버튼을 숨긴다).
- 기록: 지급은 `coaching_rewards`(V103)에 한 줄. 탈퇴하면 지운다. 계측은 버튼 노출·클릭·광고 표시·지급 확인 성공/실패다.

| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/coaching-rewards` | 앱 토큰 | `{available}` | 게이트 오류 |
| `GET /v2/coaching-rewards/requests/{request_id}` | 앱 토큰 | `{granted}` (모르는 id 는 false) | 게이트 오류 |
| `GET /v2/coaching-rewards/ssv` | AdMob 쿼리(`ad_network`·`ad_unit`·`custom_data`·`key_id`·`reward_amount`·`reward_item`·`timestamp`·`transaction_id`·`user_id`·`signature`). 앱 토큰·앱 헤더 없음(게이트 밖) | 200 `{result: granted\|duplicate\|capped\|ignored}` — 서명이 맞으면 지급하지 않아도 200 | 403 `invalid_signature`, 503 `admob_keys_unavailable`(Google 공개키를 못 받음, AdMob 이 다시 보내도 된다) |

## 광고 콘텐츠 등급(AdMob)
앱은 프로필 생년월일의 만 나이로 AdMob 요청 설정을 고른다(`adRequestConfigFor`). 만 19세 이상은 `maxAdContentRating` T 이고 그 밖의 설정은 기본이다.
만 19세 미만은 G + `tagForUnderAgeOfConsent` + 비맞춤 광고(`requestNonPersonalizedAdsOnly`)이며, 만 13세 미만이면 `tagForChildDirectedTreatment` 도 켠다.
생년월일이 없거나 프로필을 아직 받지 못했으면 청소년 기준(G·미성년·비맞춤)으로 본다. 프로필이 바뀌거나 로그아웃·계정 전환이 있으면 전역 설정을 다시 걸고, 배너는 요청마다 비맞춤 옵션을 넘긴다.

## 칸과 규격
칸 키와 규격, 칸이 둘러보기(BROWSE)·연습 중(PRACTICE)·전면 가운데 어디인지는 서버 `AdSlot`
(`apps/api/src/main/java/com/acttub/actingapi/feature/ads/domain/AdSlot.java`)이 정본이다. 앱의 칸 목록은
`apps/mobile/lib/ads.ts`에 있다. 규격 크기는 LARGE_BANNER 320x100, BANNER 320x50, MEDIUM_RECTANGLE 300x250이다(`AdSize`).
전면 칸은 응답 size 가 MEDIUM_RECTANGLE 로 오지만 쓰지 않는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/ads?slot=` | 칸 키 | `{kind, slot, size, width, height, ad}` (`ad` 에 `image_url`·`link_url`·`app_path`…). 이미지는 `ads/` 키면 1시간 서명 주소 | 422 모르는 칸 |
| `POST /v2/ads/{ad_id}/events` | `{slot, event: impression\|click}` | 204 | 404 `ad_not_found`, 422 |

## 기록
DIRECT·HOUSE 의 노출은 한 사람·광고·한국 날짜에 한 번, 클릭은 누를 때마다 `ad_events` 에 남는다. NETWORK 의 노출·클릭은 AdMob 보고서가 센다.

## 등록·운영 (운영 토큰 Bearer, `/v2/admin`)
ops.acttub.com 「광고 관리」 가 부른다. 지우기는 없고 끄는 것은 `status`(active·paused·ended)다.

| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/admin/ads` | - | 모든 광고 + 만든 뒤 지금까지 노출·클릭 합계 | 401 |
| `POST /v2/admin/ads` | 광고 값(kind·status·slots·audience·priority·advertiser_name·headline·body·image_large_banner·image_banner·image_medium_rectangle·link_url·app_path·starts_at·ends_at) | 201 광고 | 422(direct: advertiser_name·http(s) link_url·붙인 칸마다 그 칸 규격 이미지, house: `/` app_path + 이미지 또는 headline) |
| `PATCH /v2/admin/ads/{id}` | 바꿀 칸만(null 은 비움) | 광고 | 404 `ad_not_found`, 422 |
| `GET /v2/admin/ads/{id}/stats?from=&to=` | 한국 날짜(포함), 기본 오늘까지 30일, 최대 366일 | 날짜별 노출·클릭 + 기간 합계(기록 없는 날 0) | 404, 422 |
| `POST /v2/admin/ad-images` | `{size, width, height, content_type, size_bytes}` | 10분 PUT 주소 + 키 `ads/<규격>/<uuid>.<확장자>` | 415 형식, 413 2MB 초과, 422 크기(규격 또는 2~4배) |

이미지 값은 업로드 키(`ads/<규격 폴더>/…`, 칸 규격 폴더와 맞아야 한다) 또는 http(s) 주소다. 크기는 올리는 쪽이 읽어 알린 값을 믿는다(서명 업로드라 서버는 파일을 열어 보지 못한다).
