# app.ads 광고 칸

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-876 (게시판 칸 키는 SOMA-873 용으로 예약)
- 화면: 둘러보기 화면 위쪽 칸, 연습 중 기다리는 화면의 칸 (앱 안 광고 상세 화면은 없다 — 상세는 광고주 쪽 페이지)
- 테이블: ads, ad_events

## 기능
칸(slot)마다 서버가 띄울 것을 하나 고른다. 1) 광고주에게 직접 받은 광고(DIRECT — 연기학원·연극·극단 등) 2) 우리 앱 광고(HOUSE, 앱 안 경로로 이동)
3) AdMob 으로 채우기(NETWORK). 칸에 맞는 후보가 없으면 다음 단계로 넘어가고, 띄우지 않을 때는 NONE 이다.

## 노출 조건
- 첫 연습(노트가 생긴 코칭·끝까지 읽은 리딩·챌린지 참여)을 끝내기 전이면 모든 칸이 NONE 이다. 앱의 첫 사용자 홈과 같은 기준이다.
- 둘러보기 칸(BROWSE)은 Pro 도 본다(DIRECT·HOUSE·NETWORK 모두). Pro 에게 대상이 free 인 HOUSE(Pro 권유)는 가지 않는다.
- 연습 중 칸(PRACTICE)은 무료 사용자만, 그중 `ADS_PRACTICE_SLOT_PERCENT`(기본 50)% 에게만 켠다. 배정은 사용자 id 해시로 고정한다.
- `ADS_ENABLED=false` 면 모든 칸이 NONE 이다.
- DIRECT 는 칸 규격의 이미지와 http(s) `link_url` 이 있어야 하고(없으면 건너뛴다), 누르면 `link_url` 을 앱 밖 브라우저로 바로 연다. 학원 전용 칸(등록번호·교습과정·교습비)은 쓰지 않는다(열은 남아 있다).  HOUSE 는 `/` 로 시작하는 앱 안 경로와 이미지 또는 headline 이 있어야 한다.
- 같은 단계 후보가 여럿이면 priority 가 가장 큰 것들 중 사람·칸·한국 날짜마다 하나로 고정해 돌린다.

## 광고 콘텐츠 등급(AdMob)
앱은 프로필 생년월일의 만 나이로 AdMob 요청 설정을 고른다(`adRequestConfigFor`). 만 19세 이상은 `maxAdContentRating` T 이고 그 밖의 설정은 기본이다.
만 19세 미만은 G + `tagForUnderAgeOfConsent` + 비맞춤 광고(`requestNonPersonalizedAdsOnly`)이며, 만 13세 미만이면 `tagForChildDirectedTreatment` 도 켠다.
생년월일이 없거나 프로필을 아직 받지 못했으면 청소년 기준(G·미성년·비맞춤)으로 본다. 프로필이 바뀌거나 로그아웃·계정 전환이 있으면 전역 설정을 다시 걸고, 배너는 요청마다 비맞춤 옵션을 넘긴다.

## 칸과 규격
| 규격 | 크기 | 칸 |
|---|---|---|
| LARGE_BANNER | 320x100 | auditions_top, admissions_top, admission_detail_top, reading_tab_top, challenges_tab_top, challenge_detail_top, archive_top, saved_videos_top, community_list_top(예약) |
| BANNER | 320x50 | home_top, profile_top, settings_top, analyzing_top, report_top, notifications_top, line_search_top, community_post_top(예약) |
| MEDIUM_RECTANGLE | 300x250 | analyzing_wait, voice_prepare_wait (연습 중) |
| LARGE_BANNER | 320x100 | upload_wait, script_parse_wait, coaching_done, challenge_upload_done (연습 중) |

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
