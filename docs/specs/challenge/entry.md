# challenge.entry 참여

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: A18(촬영 대기·대사 표시), A18.1(올리기·챌린지에 업로드), A18.2(비공개 저장), A18.3(업로드 완료), A2.1·A2.3(보관함에서 "챌린지에 올리기"), P03
- 테이블: challenge_entries, videos

## 기능
회원이 챌린지의 대사로 촬영한 영상(또는 보관함 영상)에 캡션을 붙여 공개로 올리거나 비공개로 저장한다. 공개 참여작은 피드·랭킹에 오르고,
비공개는 나만 본다. 어느 쪽이든 AI 리포트를 요청할 수 있다.

## 의도
영상은 videos를 재사용해 보관함의 영상을 그대로 챌린지로 보낸다(ERD). "저장만 하기 · 비공개"는 비공개 행이다. 한 챌린지에 여러 번 참여할
수 있어 배우가 다시 찍어 올린다. 챌린지 영상은 60초 이내(현행 촬영 상한)로 짧게 둔다.

## 목적
배우가 부담 없이 올리고, 비공개로도 리포트를 받는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/challenges/{id}/entries` | `ChallengeEntryCreateRequest`(request_id·video_id·visibility 필수, caption·face_mosaic 선택) | `MyChallengeEntry` 201, 같은 요청 재전송 200 | `member_only`·`account_deactivated` 403, `challenge_not_found` 404, `video_not_found` 404, `challenge_closed` 422, `video_not_ready` 422, `video_too_long` 422, `duplicate_entry` 422, `request_fingerprint_mismatch` 422, 캡션 길이 422, `daily_entry_limit` 429 |
| `PATCH /v2/entries/{id}` | `ChallengeEntryPatchRequest`(caption·visibility·face_mosaic 선택) | `MyChallengeEntry` 200 | `member_only`·`account_deactivated` 403, `entry_not_found` 404, `challenge_closed` 422, `entry_hidden` 422, `video_not_ready` 422, 캡션·visibility 값 422 |
| `DELETE /v2/entries/{id}` | id | 204(이미 삭제한 것도 204) | `member_only`·`account_deactivated` 403, `entry_not_found` 404 |

참여작 조회(`GET /v2/entries/{id}`, `GET /v2/me/challenge-entries`)는 [challenge.browse](browse.md#입력출력)다.

## 상태
challenge_entries.visibility(작성자의 공개 선택)와 status(운영·삭제 상태)는 따로 움직인다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| visibility public | 공개로 생성. private에서 공개 전환(진행 중 visible 챌린지, status visible, 영상 파일 있음, 활성 계정) | challenge.entry |
| visibility private | 비공개로 생성. public에서 비공개 전환(언제든). 탈퇴(다시 공개할 수 없음) | challenge.entry, account.withdraw |
| status visible | 생성. hidden_by_report에서 신고 판정 restored·dismissed이고 남은 received 신고 없음 | challenge.entry, challenge.report |
| status hidden_by_report | visible 참여작의 유효한 첫 신고 | challenge.report |
| status deleted | 작성자 삭제 | challenge.entry |

- 공개 전환 조건(표)을 채우지 못하면 종료 뒤 422 challenge_closed, 신고 숨김 중 422 entry_hidden, 파일 파기 뒤 422 video_not_ready다.
  공개 전환과 영상 파기가 겹치면 한쪽만 성공한다. 비공개로 바꾸면 랭킹·피드·표본에서 빠지고 좋아요·댓글·저장 행은 남는다(다시 공개하면
  돌아온다). 운영 숨김은 작성자가 풀 수 없다.
- 참여작 삭제로 함께 바뀌는 것은 [영역 표](README.md#챌린지-자료의-삭제탈퇴)의 참여작 삭제 열이다. 영상 참조를 풀므로 영상은 보관함에
  남고, 그 영상의 보관함 삭제는 다른 참조가 없으면 된다(삭제되지 않은 참여작이 참조하면 422 video_in_use, practice.library). 삭제는
  되돌리지 않는다.
- 불변 조건: public이면 published_at이 있다(`ck_challenge_entries_published`). published_at은 처음 공개 시각을 유지한다. deleted ⇔ deleted_at 있음
  (`ck_challenge_entries_deleted`) ⇔ video_id NULL(`ck_challenge_entries_video`), deleted면 caption NULL(`ck_challenge_entries_purged_caption`).
  deleted가 아닌 행 사이에서 (challenge_id, video_id) 유일(`uq_challenge_entries_video`).
- 끝 상태: deleted.

## 규칙·제약
- 참여작은 challenge_id·user_id·video_id(삭제 뒤 NULL)·caption(앞뒤 공백을 걷고 코드 포인트 300자, 선택, 작성자 수정 가능, 빈 문자열은 지우기, 값이 바뀌면 content_version 증가)·visibility(public·
  private)·published_at(최초 공개 시각, 비공개 생성이면 NULL, 재공개해도 유지)·status(visible·hidden_by_report·deleted)·view_count·
  final_like_count·final_eligible·final_rank·request_id·request_fingerprint·created_at·deleted_at을 가진다.
- 참여 요청은 [요청 재전송](../common.md#요청-재전송) 규칙을 따르고 유일 범위는 (user_id, request_id)다. 삭제된 참여작의 옛 요청은 새 행을
  만들지 않고 그 행을 돌려준다.
- 영상은 파일이 남아 있는(purged_at 없는) 확정된 본인 videos 행이어야 한다. 없는 영상과 남의 영상은 404, 본인 영상이 미확정이거나 파일만
  파기됐으면 422 video_not_ready. 길이 60초 이내(기기가 적은 값과 서버가 ffprobe로 잰 실제 길이 모두 초 단위로 반올림해 60.5초 미만이면 통과,
  넘으면 422 video_too_long). 서버가 영상 객체를 읽을 수 없으면 422 video_not_ready. 챌린지 촬영(A18)의 상한도 60초다. 하한은 3초다: 앱이 3초 미만 촬영본을 올리기 전에 막고 "영상이 너무 짧아요. 3초 이상 촬영해 주세요."를 보인다(서버 검사는 아직 없다). 다른
  영상으로 같은 챌린지에 여러 번 참여할 수 있다. 하루 참여는 3개까지(429 daily_entry_limit, 삭제한 것도 센다).
- visible·진행 중인 챌린지에만 참여한다. review·hidden·deleted 챌린지는 404, 조회 가능한 종료 챌린지는 422 challenge_closed. 마감은 저장
  시점의 서버 시각으로 본다(촬영 중에 마감되면 영상은 보관함에 남고 참여작은 만들어지지 않는다). 참여 생성이 영상 파기·챌린지 삭제와
  겹치면 한쪽만 성공한다.
- 공개 범위는 올리기 화면에서 「나만 보기」가 먼저 골라져 있고, 공개는 배우가 직접 바꾼다(SOMA-748, 새 디자인). 공개로 올릴 때 "공개 참여작은 다른 참여자의 AI 리포트 비교에 쓰일 수
  있어요"를 한 줄 보여 준다(challenge.ai-report).
- **얼굴 모자이크**(SOMA-809): 올리기 화면에서 공개를 고르면 "얼굴 모자이크" 켜기 버튼이 보인다(기본 꺼짐, 공개일 때만 요청에 싣는다).
  켜면(face_mosaic true) 서버가 원본은 그대로 두고 얼굴을 픽셀 모자이크한 사본(모자이크본)을 뒤에서 만든다. mosaic_status는 pending →
  ready이고, 영상에서 얼굴을 하나도 찾지 못하거나 세 번 시도해도 만들지 못하면 failed다. **다른 사람에게는 ready인 모자이크본만 준다** —
  pending·failed인 참여작은 공개여도 피드·랭킹·상세·공유 링크·표본·종료 랭킹 어디에도 나오지 않는다(fail-closed). 본인 재생과 AI 리포트는
  원본이다. 모자이크본은 원본 옆 `videos/{사용자}/{요청}.mosaic-{참여작}.mp4`이고, 참여작 삭제·모자이크 끄기·영상 파일 파기·탈퇴 때
  정리 장부로 간다. PATCH face_mosaic true는 켜거나(failed면 다시 만든다), false는 끄고 사본을 지운다(공개 참여작이면 원본이 보인다).
  나중에 공개로 바꾸는 경로(P03 메뉴·AI 리포트 화면)는 공개하면서 모자이크를 켤지 묻는다. 만드는 중·실패는 P03 줄에 알린다.
- P03 줄은 영상 첫 장면(`poster_url`)을 미리보기로 보여 준다. 원본에서 뜬 사진이라 본인 목록(`GET /v2/me/challenge-entries`)에만
  싣고, 아직 없거나 파일이 파기된 영상은 null 이라 대체 아이콘을 둔다.
- 완료 화면(A18.3): 공개면 "공개로 올렸어요", 비공개면 "비공개로 저장했어요"와 그 아래 안내 한 줄, 옅은 파랑 알약
  "「AI 리포트 보기」를 누르면 AI가 연기를 봐 줘요". 버튼은 "AI 리포트 보기"(주)와 "홈으로 가기"(pen 10-11 「비공개로 저장했어요」).

## 예외
- 같은 영상 같은 챌린지: 422 duplicate_entry.
- 하루 4번째 참여: 429 daily_entry_limit.
- 종료 챌린지 참여: 422 challenge_closed. review·hidden·deleted 챌린지: 404. 60.5초 이상 영상: 422 video_too_long. 본인 미확정·파일 파기 영상: 422
  video_not_ready. 남의 영상·없는 영상: 404.
- 참여작 삭제 뒤 같은 영상으로 다시 참여: 된다(새 행).
- 캡션 301자: 422.

## 검증 방법
- 보관함 영상(45초)으로 공개 참여: challenge_entries 1행(visibility public, status visible, published_at 지금), 랭킹·피드에 보인다. 올리기 화면에
  표본 활용 안내 한 줄이 있다. 정확히 60초: 200.
- 비공개 저장: published_at NULL, 목록에 없고 P03에 "비공개 저장", 완료 문구 "비공개로 저장했어요". 공개 완료 문구: "무대에 올렸어요".
- 공개 범위를 바꾸지 않고 올리기: 나만 보기(private)로 올라간다.
- 같은 요청 id·같은 지문 두 번: 행 하나. 다른 지문: 422. 같은 영상 같은 챌린지: 422 duplicate_entry. 다른 영상: 두 번째 행.
- 하루 4번째: 429 daily_entry_limit. 종료 챌린지: 422 challenge_closed. review 챌린지: 404. 60.5초: 422 video_too_long. 60.4초: 200. 본인 미확정 영상: 422
  video_not_ready. 파일만 파기한 본인 영상: 422 video_not_ready. 남의 영상: 404.
- 마감 1초 뒤 저장 요청: 422 challenge_closed, 영상은 보관함에 있다.
- 공개 → 비공개: 랭킹에서 빠지고 entry_likes·entry_comments·entry_saves 행은 남는다. 다시 공개(진행 중): 좋아요 수·댓글 그대로 돌아오고
  published_at은 처음 값이다. 종료 뒤 공개 전환: 422 challenge_closed. 신고 숨김 중: 422 entry_hidden. 파일 파기 뒤: 422 video_not_ready.
- 캡션 수정(작성자): 바뀌고 content_version이 오른다. 다른 사람: 404. 301자: 422.
- 삭제: status deleted, video_id NULL, caption NULL, 그 참여작의 entry_likes·entry_saves·entry_ai_reports(본문)·notifications 행이 없고 entry_comments는
  본문 없이 deleted_at, videos 행은 있다. 보관함에서 그 영상 삭제: 다른 참조가 없으면 된다.
- 삭제 뒤 같은 영상으로 새 요청 id로 참여: 새 행. 삭제된 참여작의 옛 요청 id 재전송: 새 행 없음.
- 탈퇴: 참여작 visibility private, 목록에 없음, 공개 전환 API 403.
- 얼굴 모자이크를 켜고 공개: 만드는 동안 다른 사람의 피드·상세·공유 조회에 없고 본인은 원본을 재생한다. 모자이크본이 붙으면 다른 사람의
  playback_url은 모자이크본, 본인은 원본이다. 얼굴이 없는 영상: failed, 다른 사람에게 계속 없다. 다시 켜면 pending부터 다시. 끄면 원본이
  공개된다. 만드는 사이 삭제된 참여작: 늦게 만든 사본은 붙지 않고 정리 장부로 간다(`ChallengeEntryIT` faceMosaic_*).

## 범위 밖
- 참여작 삭제 되돌리기.
- 탈퇴한 계정의 참여작 재공개.
