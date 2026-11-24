# app.poster 공지 포스터

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.3
- 화면: 홈 진입 공지 포스터(옛 고품질 목소리 출시 기념 팝업과 같은 모양)
- 테이블: app_posters

## 기능
앱이 홈에 들어올 때 서버가 내려준 공지 포스터를 전체 화면으로 한 장 띄운다. 배지·제목·본문·그림·샘플 소리·버튼과
「다시 보지 않기」를 포스터마다 서버 데이터로 정하고, 운영자는 관리자 API 로 앱 업데이트 없이 내용을 바꾼다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/app/posters` | 헤더 `Authorization`(회원·게스트), 질의 `platform`(ios·android, 필수), `locale`(두 글자, 선택), `app_version`(점으로 이은 숫자 64자까지, 선택) | `AppPosterList` 200: 띄울 수 있는 포스터 최대 5장 | 질의 값이 빠지거나 틀리면 422(배열) |
| `GET /v2/app/notices` | 헤더 `Authorization`(회원·게스트), 질의 `platform`(ios·android, 필수), `locale`(두 글자, 선택) | `AppNoticeList` 200: 아직 시작 전이 아닌 모든 포스터(꺼진 것·기간이 끝난 것 포함)를 공지한 날(`starts_at`, 없으면 만든 날) 늦은 순으로 최대 50건. 건마다 `live`(켜져 있고 기간 안), `published_at`, `ends_at` 과 팝업과 같은 제목·본문·이미지·버튼 | 질의 값이 빠지거나 틀리면 422(배열) |
| `GET /v2/admin/posters` | 헤더 `Authorization: Bearer $ADMIN_OPS_TOKEN` | `{posters: AdminPoster[]}` 200: 꺼진 것까지 전부, 저장된 값 그대로 | 토큰이 없거나 틀리면 401 `Unauthorized` |
| `POST /v2/admin/posters` | 운영 토큰, 본문 `AdminPosterFields`(아래 「필드」, id·revision·시각 제외, 모르는 칸은 422) | `AdminPoster` 201 | 같은 (slug, locale) `duplicate_poster` 422, 칸 규칙 위반 422(배열), 401 |
| `PATCH /v2/admin/posters/{id}` | 운영 토큰, 바꿀 칸만 담은 객체, 선택 `bump_revision: true` | `AdminPoster` 200 | 없으면 `poster_not_found` 404, `duplicate_poster` 422, 칸 규칙 위반·모르는 칸 422(배열), 401 |
| `POST /v2/admin/poster-images` | 운영 토큰, `{content_type: image/png·image/jpeg·image/webp, size_bytes}` | `{key, upload_url, expires_in}` 200: `posters/<uuid>.<ext>` 키와 10분짜리 PUT 주소 | 다른 형식 `unsupported_media_type` 415, 10MB 초과 `upload_too_large` 413, 스토리지 없음 `storage_not_configured` 503, 401 |

운영 경로는 `ADMIN_OPS_TOKEN` 이 설정된 서버에만 있다. 지우는 경로는 없다 — 끄는 것은 `active=false` 다. 운영자의 curl 사용법은
팀 위키 `guides/app-poster-admin`에 있다.

### 필드
| 칸 | 뜻 | 기본값 |
|---|---|---|
| `slug` | 기기의 봤음·다시 보지 않기 저장 열쇠. 소문자·숫자·하이픈 1~64자. (slug, locale) 은 언어 없음까지 포함해 유일하다. | 필수 |
| `revision` | 판. 운영자가 `bump_revision` 으로만 올린다. 올리면 기기의 기록이 무효가 되어 다시 보인다. | 1 |
| `active` | 켜짐. 꺼진 포스터는 앱에 가지 않는다. | false |
| `priority` | 큰 값이 먼저. 같으면 최근에 고친 것이 먼저. | 0 |
| `starts_at`·`ends_at` | 보이는 기간. null 은 제한 없음, `ends_at` 은 그 시각을 포함하지 않는다. 오프셋이 있는 ISO-8601. | null |
| `platforms` | `ios`·`android` 중 하나 이상. | 둘 다 |
| `locale` | null 은 모든 언어, 아니면 앱 표시 언어 하나(`ko`·`en`). | null |
| `min_app_version` | 이 판 이상의 앱에만(`0.1.10 > 0.1.9`). 점으로 이은 숫자 64자까지. 판을 밝히지 않은 앱에는 가지 않는다. | null |
| `frequency` | `daily` 는 한국 날짜 하루 한 번, `once` 는 한 번만, `every` 는 앱에 들어올 때마다(홈 재진입·앱 복귀 포함, SOMA-799). | daily |
| `audience` | `all` 또는 `cloud_voice_off`(고품질 목소리를 쓸 수 있고 아직 켜지 않은 사람에게만 — 판정은 앱). | all |
| `dismissible` | 「다시 보지 않기」 버튼을 보인다. | true |
| `badge`·`title`·`body` | 배지·제목·본문. `title` 만 필수이고 비면 그 칸을 숨긴다. 제목의 줄바꿈은 그대로 보인다. | null |
| `image` | `asset:mascot-reading`(앱 번들) 또는 이미지 올리기로 받은 `posters/<uuid>.<png·jpg·webp>`. 앱이 모르는 자산 이름이면 숨긴다. | null |
| `audio` | `asset:cloud-voice-sample`(앱 번들)만 재생 버튼이 된다. 객체 키는 받지만 앱에 내지 않는다. | null |
| `cta_label`·`cta_action`·`cta_target` | 버튼 문구와 동작. `none`(버튼 없음)·`cloud_voice_enable`(고품질 목소리 켜기 동의 시트)·`route`(`/` 로 시작하는 앱 경로)·`url`(`https://` 주소). 문구가 없으면 버튼을 숨긴다. | none |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| 꺼짐 | 만들기(기본), `active=false` 로 고치기 | app.poster(운영) |
| 켜짐 | `active=true` 로 만들거나 고치기 | app.poster(운영) |

켜짐이어도 기간·플랫폼·언어·판이 맞아야 앱에 간다. 끝 상태는 없다 — 지우지 않고 끈다. revision 은 줄지 않는다.

기기 상태(`acttub.posters`, AsyncStorage)는 slug 마다 `{revision, lastShownDay, shownOnce, dismissedForever}` 다. 저장된
revision 이 포스터와 다르면 그 slug 의 기록은 없던 것으로 본다. 0.1.2 의 옛 키 `acttub.cloudVoicePromo` 가 남아 있으면 처음
읽을 때 `cloud-voice-launch`(revision 1)의 기록으로 옮기고(다시 보지 않기·마지막 본 날짜) 옛 키를 지운다.

## 규칙·제약
- 서버는 켜져 있고 기간 안이며 플랫폼이 맞고 언어가 없거나 같은 것을 우선순위 큰 것, 최근에 고친 것 순으로 고르고,
  판이 맞는 것만 앞에서 5장 낸다. 이미지가 객체 키면 1시간짜리 주소(`image_url`)를, 번들 자산이면 이름(`image_asset`)을 낸다.
- 앱은 서버 순서대로 처음 보일 수 있는 한 장만 띄운다. 넘기는 것: 다시 보지 않기를 누른 것, `daily` 인데 오늘(한국 날짜) 이미
  본 것, `once` 인데 이미 본 것, `cloud_voice_off` 인데 고품질 목소리를 쓸 수 없거나(상태를 모를 때 포함) 이미 켠(켬 + 동의
  granted) 사람.
- 띄우는 순간 그 날을 본 날로 적는다. 「다시 보지 않기」는 그 판에서 다시 띄우지 않는다.
- `every`(SOMA-799): 홈에 다시 들어오거나 앱이 앞으로 돌아올 때마다 서버를 다시 읽어 띄운다. 닫기 버튼은 「오늘 하루 안 보기」(기기 현지 날짜로 그날만 숨김, 판이 바뀌어도 그날은 유지)와 일반 닫기다. 일반 닫기 뒤에는 다음으로 보일 수 있는 공지를 이어서 띄워, 앞의 `every` 공지가 다른 공지를 가리지 않게 한다. `every` 로 바꾼 공지는 예전 「다시 보지 않기」 기록을 무시한다.
- 공지사항 화면(SOMA-919): 설정 「공지사항」 → 목록 → 상세 전체 화면이다(팝업·시트 없음, 받는 동안 뼈대). 목록은 `GET /v2/app/notices` 를 그대로 순서대로 보이고 진행 중·종료 표시와 공지한 날(한국 날짜)을 붙인다. 상세는 팝업과 같은 그림·배지·제목·본문이며, 버튼은 지금 떠 있는(`live`) 공지의 `route`·`url` 만 보인다(`cloud_voice_enable` 은 동의 시트가 필요해 목록에서 열지 않는다). 기기의 봤음·다시 보지 않기 기록과 `audience`·`min_app_version` 은 따지지 않는다.
- 띄우는 조건은 0.1.2 팝업과 같다: 로그인 상태, 첫 실행 온보딩 직후가 아님, 다른 시트(소개·가이드·연속 기록 축하)가 떠 있지 않음.
- 버튼: `cloud_voice_enable` 은 포스터를 닫고 0.35초 뒤 동의 시트를 연다(iOS 는 모달 위에 모달을 올리지 못한다). `route` 는
  닫고 그 앱 경로로 간다. `url` 은 닫고 외부 브라우저로 연다.
- 고품질 목소리를 켜면(켬 + granted) 떠 있던 `cloud_voice_off` 포스터를 닫는다.
- 분석 이벤트는 `poster_shown`·`poster_cta`·`poster_close`·`poster_dismiss`(`{slug, revision}`)다.

## 예외
- 포스터 요청 실패·빈 목록: 아무것도 띄우지 않는다. 앱 진입을 막지 않는다.
- 이미지 서명 실패·스토리지 없음: 그 포스터의 `image_url` 만 null 이고 앱은 그림 칸을 숨긴다.
- 앱이 모르는 번들 자산 이름, 안전하지 않은 버튼 대상(`route` 가 `/` 로 시작하지 않음, `url` 이 `https://` 가 아님): 그 칸·버튼을
  숨긴다.
- 고품질 목소리 상태를 받지 못함(게스트 포함): `cloud_voice_off` 포스터는 띄우지 않는다.

## 검증 방법
- 꺼진 것·기간 밖·다른 플랫폼·다른 언어 포스터를 넣고 `GET /v2/app/posters`: 응답에 없다(`PosterEndpointIT`).
- `min_app_version=0.1.10` 포스터: `app_version=0.1.9`·없음이면 빠지고 `0.1.10` 이면 들어온다.
- 같은 우선순위 7장: 최근에 고친 5장만 온다.
- 객체 키 이미지: `image_url` 이 1시간 주소, 서명 실패면 null 이고 200.
- 운영 토큰 없음·틀림·사용자 토큰: 운영 경로 넷 다 401 `Unauthorized`.
- `PATCH` 로 `title` 만: 나머지 칸은 그대로, `updated_at` 이 늘고 revision 은 그대로. `bump_revision: true`: revision +1.
- 이미지 올리기 `image/webp`: `posters/<uuid>.webp` 키와 600초 주소. `image/gif` 415, 10MB 초과 413.
- 앱(`tests/poster.test.mjs`): 오늘 본 `daily` 는 넘기고 다음 날 보인다, 본 `once` 는 다시 안 보인다, 다시 보지 않기는 넘긴다,
  revision 이 바뀌면 다시 보인다, 옛 키의 다시 보지 않기가 `cloud-voice-launch` 로 옮겨지고 옛 키가 지워진다.
- V29 뒤 `cloud-voice-launch` ko·en 두 줄이 0.1.2 문구로 있다(`PosterSchemaMigrationTest`).

## 범위 밖
- 지우기 API. 끄기는 `active=false` 다.
- 사용자·코호트 단위 대상 지정, A/B, 노출 통계 저장. 노출은 분석 이벤트로만 센다.
- 웹. 포스터는 앱에만 띄운다.
- 서버 오디오 재생. 소리는 앱 번들 자산만 쓴다.
