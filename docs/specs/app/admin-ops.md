# app.admin-ops 운영 조회
- 도입: 0.1.0
- 화면:
- 테이블: 없음(다른 기능의 표를 읽기만 한다)

## 기능

운영자가 운영 토큰으로 서비스 이용 기록, 자문단 대화, 챌린지 영상·댓글·목록, 리딩 회차를 조회하고 영상·녹음을 짧게 재생한다.
배우는 가명으로 가리고, 개인을 알아볼 수 있는 값은 싣지 않는다. 구현 규칙은 [CONTRACT](../../../apps/api/CONTRACT.md) §6-15(ops-core·자문단
대화)·§6-21·§6-22·§6-25·§6-27에 둔다. 운영 피드백 조회는 [practice.feedback](../practice/feedback.md), 챌린지 개설·moderation과
신고 판정은 [challenge.create](../challenge/create.md)·[challenge.report](../challenge/report.md), 포스터·광고·문의의 운영 경로는
[app.poster](poster.md)·[app.ads](ads.md)·[app.support-inquiry](support-inquiry.md)가 정본이다. 구독자 목록(`GET /v2/admin/subscribers`)은
[billing.subscription](../billing/subscription.md)이 `plan` 칸만 적는다. `GET /v2/admin/sessions`·`GET /v2/admin/actor-names`, 광고 설정
(`/v2/admin/ad-settings`), 블로그 운영 경로(`/v2/admin/blog/**`·`/v2/admin/blog-images`)는 아직 스펙이 없다(코드 `AdminController`·
`AdSettingsAdminController`·`BlogAdminController`).

## 입력·출력

모든 입구는 헤더 `Authorization: Bearer <ADMIN_OPS_TOKEN>`을 받는다. 질의 `exclude_actors`는 팀으로 볼 배우 가명(`md5(user_id)`
앞 8자리, 소문자 16진)을 쉼표로 최대 100개 받는다.

| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/admin/ops-core` | `exclude_actors` | 운영 스냅샷 객체 200. 아래 「규칙·제약」의 `activity_rows`·`signup_rows`·`features.challenges`·`upload_only_rows`를 담는다 | 401 `Unauthorized`, `exclude_actors` 형식 422(배열) |
| `GET /v2/admin/advisor-sessions` | `limit`(1~200, 기본 100) | 자문단 대화 목록 200 | 401, `limit` 422(배열) |
| `GET /v2/admin/challenge-videos` | `limit`(1~100, 기본 50), `visibility`(all·public·private), `exclude_actors` | `{entries, count}` 200 | 401, 질의 값 422(배열) |
| `GET /v2/admin/challenge-videos/{id}/playback` | 참여작 id, `exclude_actors` | `{playback_url, expires_in: 600}` 200 | `challenge_video_not_found` 404, `playback_unavailable` 503, 401 |
| `GET /v2/admin/upload-only-videos/{id}/playback` | `upload_only_rows[].upload_intent_id`, `exclude_actors` | `{playback_url, expires_in: 600}` 200 | `upload_video_not_found` 404, `playback_unavailable` 503, 401 |
| `GET /v2/admin/reading-sessions` | `limit`(1~100, 기본 50), `status`(all·in_progress·completed), `exclude_actors` | `{sessions, count}` 200 | 401, 질의 값 422(배열) |
| `GET /v2/admin/reading-sessions/{id}` | 회차 id, `exclude_actors` | `{session, lines, recordings}` 200 | `reading_session_not_found` 404, 401 |
| `GET /v2/admin/reading-recordings/{id}/playback` | 녹음 id, `exclude_actors` | `{playback_url, expires_in: 600}` 200 | `reading_recording_not_found` 404, `playback_unavailable` 503, 401 |
| `GET /v2/admin/challenges` | `limit`(1~100, 기본 50), `exclude_actors` | `{challenges, count}` 200 | 401, 질의 값 422(배열) |
| `GET /v2/admin/challenge-comments` | `limit`(1~200, 기본 100), `exclude_actors` | `{comments, count}` 200 | 401, 질의 값 422(배열) |

`count`는 지금 돌려준 묶음의 크기다. 토큰이 없는 서버에는 이 경로들이 없다.

## 상태

없음 — 조회만 한다.

## 규칙·제약

공통

- 토큰을 질의 값 검증보다 먼저 본다. 토큰이 틀리면 질의 값이 틀려도 401이다.
- 팀은 운영 이메일(`ADMIN_OPS_EXCLUDE_EMAILS`)의 계정과 `exclude_actors` 배우다. 경로마다 팀을 빼거나 표시만 한다(아래).
- ops-core를 뺀 성공 응답은 `Cache-Control: private, no-store`다. ops-core는 운영 도구가 git에 스냅샷으로 남기는 JSON이라 가명과
  뭉갠 시각만 싣는다.
- 재생 주소의 시한은 600초 고정이다. 스토리지가 없거나 서명이 실패하면 503 `playback_unavailable`이다.

ops-core

- **통합 이용 기록**(`activity_rows`): 코칭 세션·대본 리딩 세션·삭제되지 않은 챌린지 참여작의 전체 기록을 한 목록으로 낸다. 기존
  `sessions`·`features`의 뜻은 바꾸지 않는다.
  - 각 행은 `activity_id`(`coaching:`·`reading:`·`challenge:` + 원천 행 id), `feature`, `created_at`, `actor`, `signup_at`,
    `signup_d7`, `platform`, `device`, `status`, `is_team`만 가진다. `actor`는 `배우 ` + `md5(user_id)` 앞 8자리라 기능을 넘나드는
    사람도 중복 제거할 수 있다. 이메일·원본 user id·대본·평가·댓글 같은 자유 입력은 넣지 않는다.
  - 활동 시각은 분, 가입 시각은 시간 단위로 뭉갠다. `signup_d7`은 뭉개기 전 시각으로 최근 7일 가입 여부를 계산해 SQL 퍼널과
    같은 가입 코호트를 쓴다.
  - 세 기능 모두 팀을 빼고 미래 시각은 뺀다. 참여작 조회·좋아요·댓글은 연습 이용으로 합치지 않는다.
  - 행 제한 없이 전체 이력을 내고, 기록이 없으면 `[]`다. 필드가 없는 옛 응답·결측을 0으로 읽거나 코칭 전용 숫자를 통합 수치로
    대신 쓰지 않는다. 운영 개요는 같은 `actor`로 인원·반복·재방문을 센다.
- **가입 코호트 원장**(`signup_rows`, SOMA-591): 팀을 뺀 가입자 한 명당 한 행이다. `actor`·`signup_at`(시간 단위)·
  `platform`(`앱`·`웹`)·`device`(가입 기기 분류)·`first_upload_at`(가장 이른 확정 업로드, 분 단위, 없으면 null)·
  `experience`·`goal`(가입 프로필의 값 이름, 프로필이 없으면 null)·`directions`(`media`·`stage` 정렬 배열, 없으면 `[]`)·
  `discovery_answered`·`discovery_source`·`discovery_detail`(가입 직후 유입 경로 자기 응답의 값 이름, 답이 없으면 false·null·null)·
  `signup_client`(가입 프로필을 처음 완성한 클라이언트 판, 없으면 null)·`airbridge_lookup_pending`(Airbridge 귀속을 아직 찾는
  중인지)·`active_days`(들어온 날 KST, 오래된 날부터)를 가진다. 이름·생년월일·소개 글·유입 경로 직접 입력·기기 ID는 싣지 않는다.
  미래 행은 뺀다. 운영 화면은 이를 `activity_rows`·`signup_attributions`와 가명으로 이어 플랫폼×유입 소스 퍼널을 같은 기간 가입
  코호트로 센다. `signup_attributions`는 기존 키에 `source`와 nullable `medium`을 더 준다. 필드가 없는 옛 응답을 0명으로 읽지
  않는다.
- **챌린지 참여작**(`features.challenges`): `entries.private` 수와 `recent_entries`(삭제되지 않은 최신 50건)를 준다. 비공개
  참여작도 운영이 봐야 하므로 `visibility`를 싣는다. 한 항목은 `entry_id`·`challenge_id`(둘 다 앞 8자리)·`challenge_origin`·
  `actor`·`visibility`·`status`·`has_video`·`created_at`·`published_at`(분 단위)·`views`·`likes`·`comments`(팀 제외)·
  `ai_report`(없으면 null)다. 캡션·챌린지 대사·이메일·원본 id는 넣지 않는다(git에 남는 JSON이다). 팀·미래 시각 행은 뺀다.
- **업로드 완료 · 연습 미시작 기록**(`upload_only_rows`): 조회 시점에 연습·챌린지와 연결되지 않은 확정 업로드를 따로 낸다. 기존
  `sessions`·`activity_rows`·퍼널·코칭 지표의 계산과 뜻은 바꾸지 않는다.
  - 필드는 `upload_intent_id`·`created_at`·`actor`·`is_team`·`platform`·`device`·`duration_ms`다. 시각은 확정 시각을 우선하고
    없으면 업로드를 만든 시각이며 UTC 분 단위로 낮춘다. 원본 user id·이메일·파일 경로·URL·자유 글은 싣지 않는다.
  - 팀 행도 빼지 않고 `is_team=true`로 표시한다. 화면이 기본으로 거른다.
  - 같은 영상으로 연습을 시작하면 그 업로드의 행은 사라지고, 같은 배우의 다른 미연결 업로드는 남는다. 파기한 영상의 업로드도 뺀다.
  - 업로드 목적은 저장되지 않으므로 보관용인지 이탈인지 단정하지 않는다. 삭제된 챌린지나 영상과의 연결은 사라질 수 있어 지난
    연결 이력도 되살릴 수 없다. 지금 연결 상태의 조회이지 이탈 확정·코칭 실패·재생 가능 여부의 판정이 아니다. 화면에도 이 한계를
    알린다.
  - 전체 이력을 완료 시각 내림차순(같으면 업로드 id 내림차순)으로 낸다. 기록이 없으면 `[]`이고, 필드 누락·형식 오류는 0이 아니라
    확인 불가로 다룬다.

자문단 대화

- 자문위원(코치 성격 배정과 같은 자문위원 목록)의 새 대화와 이관 전 옛 코치 세션을 최신순(같은 시각이면 id)으로 낸다. 가명,
  자문위원 해시(`advisor_hash`, 목록에 이미 있는 값이라 새로 드러나는 것이 없다), 코치 성격(없으면 null), 대화 원문, 세션 목록과
  같은 1시간 영상 재생 주소(`video_url`, 지워진 영상·서명 실패면 null)를 싣는다. 이메일·원본 user id는 싣지 않는다.
- 팀 제외는 하지 않는다. 자문위원 목록 자체가 범위다.

챌린지 영상

- 목록의 각 행은 `id`(참여작 UUID)·`actor`(`md5(user_id)` 앞 8자리)·`created_at`·`visibility`·`status`·`challenge_kind`
  (`challenges.origin`)·`challenge_ref`(`md5(challenge_id)` 앞 8자리)·`has_video`·`likes`(받은 좋아요 전체, 팀 포함)·`outside_likes`
  (그중 팀이 누른 것을 뺀 값)만 가진다. 원본 참여작 id는 이 live 운영 응답에서만 허용한다. user UUID·이메일·대사·작품·캡션 같은
  자유 글·객체 키·재생 주소는 목록에 넣지 않는다.
- 팀 배우의 참여작, 삭제된 참여작, 삭제된 챌린지의 참여작은 목록과 재생에서 뺀다.
- 재생은 없음·팀·삭제·영상 없음·파기를 모두 404 `challenge_video_not_found` 하나로 답한다.
- 업로드만 한 영상의 재생은 `upload_only_rows`와 같은 판정(확정 · 연습/챌린지 미연결 · 미파기)을 지나고 살아 있는 영상 행이
  있을 때만 한다. 없음·팀·미완료·연결됨·파기·영상 행 없음은 모두 404 `upload_video_not_found`다.

리딩 회차

- 활성 계정(탈퇴하지 않았고 3년 파기 전)의 회차만 읽는다. 팀은 목록·상세·재생에서 똑같이 뺀다.
- 목록의 각 행은 `id`(회차 UUID)·`actor`(접두사 없는 8자리 가명)·`script_title`·`started_at`·`ended_at`(늘 있고 없으면 null)·
  `status`·`mode`(`read`·`quiz`)·`elapsed_seconds`·`recording_count`만 가진다. `started_at DESC, id DESC`로 고정 정렬한다. 대본
  본문·전사·원본 user id·이메일·객체 키·재생 주소는 넣지 않는다.
- 상세의 `session`은 목록과 같은 칸이다. `lines`는 대본 전체를 `ordinal ASC`로 내고 각 줄은 `id`·`ordinal`·`kind`·
  `character_name`·`text`·`in_range`·`is_mine`이다. `kind`는 저장값 `dialogue`·`direction`·`scene` 그대로다. `in_range`는 회차의
  시작·끝 줄을 포함한 범위이고, `is_mine`은 줄의 배역이 회차의 내 배역에 들었는지다. `recordings`는 그 회차의 내 배역 대사
  녹음만 가지며 `id`·`line_id`·`attempt_no`·`duration_ms`·`created_at`·`transcript_source`(`stt`·`none`)·`transcript`·`matched`를
  싣는다. `transcript`·`matched`는 늘 있고 없으면 null이다. 대본과 전사는 git 스냅샷에 남기지 않는 이 live 상세에서만 허용한다.
- 상대역 음성은 기기 TTS라 저장 대상이 아니므로 녹음 수·상세·재생 모두 내 배역 대사 줄만 센다.
- 상세는 회차가 없거나 팀이거나 대본·줄 연결이 어긋나면 404 `reading_session_not_found`다. 재생은 없음·팀·비활성 계정·탈퇴
  보관으로 연결이 끊긴 녹음·회차/대본/줄과 맞지 않는 녹음·내 배역 대사가 아닌 녹음·m4a가 아닌 녹음을 모두 404
  `reading_recording_not_found`로 답한다. 삭제된 리딩 자료는 행째 없어 보이지 않는다.

챌린지 목록

- 삭제되지 않은 챌린지를 진행 중(`active`) → 예정(`scheduled`) → 종료(`ended`) 순으로, 같은 상태 안에서는 `featured_on` 최신·
  시작 최신 순으로 싣는다.
- 각 행은 `id`·`line`·`work`·`character`·`origin`·`host_actor`(`md5(host_user_id)` 앞 8자리, 운영 개설(`origin=team`)은 null)·`host_is_team`·
  `duration_days`·`featured_on`·`starts_at`·`ends_at`·`state`·`moderation`·`entries`·`public_entries`·`outside_entries`·`likes`·
  `outside_likes`다. 참여작 수는 삭제를 뺀 값이고 `outside_entries`는 팀의 참여작을 뺀 값이다. `likes`는 삭제되지 않은 참여작이
  받은 좋아요 전체(팀 포함)이고 `outside_likes`는 그중 팀이 누른 것을 뺀 값이다.
- 챌린지는 앱에 공개되는 글이라 대사·작품·인물을 싣는다(챌린지 영상 목록과 다르다). 주최자의 user UUID·이메일과 참여작 캡션은
  싣지 않는다. 저장되는 ops-core에는 대사를 넣지 않는다.
- 팀 계정이 연 챌린지도 빼지 않고 `host_is_team`으로 표시한다.

챌린지 댓글

- 챌린지 참여작에 달린 댓글을 `created_at` 최신 순으로 싣는다. 각 행은 `id`(댓글 UUID)·`entry_id`(참여작 UUID, 챌린지 영상 목록의
  `id`와 같다)·`entry_actor`·`entry_is_team`·`entry_visibility`·`challenge_ref`(`md5(challenge_id)` 앞 8자리)·`actor`(작성자
  가명)·`actor_is_team`·`body`·`status`(`visible`·`hidden`)·`created_at`이다.
- 댓글은 앱에서 다른 배우에게 보이는 글이라 본문을 싣는다. user UUID·이메일·캡션·대사·영상 정보는 싣지 않는다. 지워진 댓글과
  삭제된 참여작·챌린지의 댓글은 뺀다.
- 팀이 쓴 댓글과 팀 참여작의 댓글도 빼지 않고 `actor_is_team`·`entry_is_team`으로 표시한다. 저장되는 ops-core에는 댓글 본문을
  넣지 않는다.

## 예외

- 토큰 없음·틀림·사용자 토큰: 질의 값을 보기 전에 401 `Unauthorized`.
- `exclude_actors`에 8자리 16진이 아닌 값이 있거나 100개를 넘음: 422(배열).
- 스토리지가 없는 서버의 재생: 503 `playback_unavailable`.

## 검증 방법

- 토큰 없이 각 경로: 401이고 DB를 읽지 않는다(`AdminEndpointIT`).
- `limit=0`·범위 밖·숫자 아님: 422 배열(`loc` = query, limit).
- 팀 배우가 연 참여작이 있는 DB에서 `GET /v2/admin/challenge-videos`: 팀 참여작·삭제된 참여작이 없고 원본 user id·캡션이 없다.
- 팀 참여작 id로 재생: 404 `challenge_video_not_found`. 남의 공개 참여작: 600초 주소.
- 연습과 연결된 업로드 id로 업로드 재생: 404 `upload_video_not_found`. 연결 안 된 확정 업로드: 600초 주소.
- 리딩 회차 목록: `started_at DESC, id DESC` 순이고 대본 본문·전사가 없다. 상세: 대본 전체 줄과 그 회차의 내 배역 녹음만 있다.
- ops-core에서 팀 배우의 업로드만 한 영상: 빠지지 않고 `is_team=true`. 연습을 시작한 업로드: `upload_only_rows`에 없다.
- ops-core `activity_rows`: 팀·삭제·미래 행이 없고, 기록이 없으면 `[]`.
- 팀 계정이 연 챌린지: 목록에 있고 `host_is_team=true`, `host_actor`는 그 계정의 가명이다. 운영 개설 챌린지(`origin=team`, 주최
  계정 없음): `host_actor`는 null, `host_is_team=false`.
- 토큰을 둔 서버의 OpenAPI: 커밋된 `spec/openapi.json`에 없는 경로가 운영 경로 목록과 정확히 같다.

## 범위 밖

- 운영 화면(ops 도구)의 그리기와 집계 방식.
- 쓰기 경로. 챌린지 개설·moderation, 신고 판정, 포스터·광고 관리, 연습 자료 전환은 각 기능 스펙과 CONTRACT가 다룬다. 블로그 관리는
  스펙이 없다(위 「기능」).
- 운영 피드백 조회는 [practice.feedback](../practice/feedback.md)이 다룬다.
