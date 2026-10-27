# app.ads 광고 칸

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-876 (게시판 칸 키는 SOMA-873 용으로 예약)
- 화면: 둘러보기 화면 위쪽 칸, 연습 중 기다리는 화면의 칸, 학원 광고 상세
- 테이블: ads, ad_events

## 기능
칸(slot)마다 서버가 띄울 것을 하나 고른다. 1) 계약 중인 학원 직접 광고(DIRECT) 2) 우리 앱 광고(HOUSE, 앱 안 경로로 이동)
3) AdMob 으로 채우기(NETWORK). 칸에 맞는 후보가 없으면 다음 단계로 넘어가고, 띄우지 않을 때는 NONE 이다.

## 노출 조건
- 첫 연습(노트가 생긴 코칭·끝까지 읽은 리딩·챌린지 참여)을 끝내기 전이면 모든 칸이 NONE 이다. 앱의 첫 사용자 홈과 같은 기준이다.
- 둘러보기 칸(BROWSE)은 Pro 도 본다(DIRECT·HOUSE·NETWORK 모두). Pro 에게 대상이 free 인 HOUSE(Pro 권유)는 가지 않는다.
- 연습 중 칸(PRACTICE)은 무료 사용자만, 그중 `ADS_PRACTICE_SLOT_PERCENT`(기본 50)% 에게만 켠다. 배정은 사용자 id 해시로 고정한다.
- `ADS_ENABLED=false` 면 모든 칸이 NONE 이다.
- DIRECT 는 칸 규격의 이미지가 있어야 하고, HOUSE 는 `/` 로 시작하는 앱 안 경로와 이미지 또는 headline 이 있어야 한다.
- 같은 단계 후보가 여럿이면 priority 가 가장 큰 것들 중 사람·칸·한국 날짜마다 하나로 고정해 돌린다.

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
| `GET /v2/ads?slot=` | 칸 키 | `{kind, slot, size, width, height, ad}` | 422 모르는 칸 |
| `GET /v2/ads/{ad_id}` | 직접 광고 id | 광고주명·학원 등록번호·교습과정·교습비·이미지·외부 링크 | 404 `ad_not_found`(없음·자체 광고) |
| `POST /v2/ads/{ad_id}/events` | `{slot, event: impression\|click}` | 204 | 404 `ad_not_found`, 422 |

## 기록
DIRECT·HOUSE 의 노출은 한 사람·광고·한국 날짜에 한 번, 클릭은 누를 때마다 `ad_events` 에 남는다. NETWORK 의 노출·클릭은 AdMob 보고서가 센다.

## 등록
관리 화면은 없다. 처음엔 운영 DB 에 직접 넣는다(`ads` 한 행, kind·slots·이미지·기간·상태).
