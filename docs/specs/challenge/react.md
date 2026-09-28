# challenge.react 좋아요·저장·댓글

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: A15(피드 반응 메뉴), A15.3(댓글 모달), A15.5(저장한 영상), A4(프로필의 저장한 영상 진입)
- 테이블: entry_likes, entry_saves, entry_comments, user_blocks, challenge_entries

## 기능
노출 가능한 다른 사람의 참여작에 좋아요를 누르고, 참고할 영상을 저장해 모아 보고, 댓글을 남긴다. 좋아요는 랭킹의 기준이다. 공유는 참여작
링크를 보낸다.

## 의도
좋아요·저장은 (entry_id, user_id) 유일인 연결 표이고 요청은 멱등이다(ERD). 좋아요 수는 재집계다(CONTRACT §7). 댓글은 작성자가 탈퇴해도
남고 이름만 "탈퇴한 사용자"로 바뀐다(account.withdraw, community 보관 결정). 댓글 좋아요·답글은 0.1.0에 없다.

## 목적
배우가 다른 배우의 연기에 반응을 남기고, 참고할 영상을 모아 둔다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `PUT /v2/entries/{id}/like`, `DELETE /v2/entries/{id}/like` | id | `EntryLikeState` 200 | `member_only` 403, `entry_not_found` 404, `self_like` 422 |
| `PUT /v2/entries/{id}/save`, `DELETE /v2/entries/{id}/save` | id | `EntrySaveState` 200 | `member_only` 403, `entry_not_found` 404, `self_save` 422 |
| `GET /v2/me/saved-entries` (A15.5) | `cursor` | `SavedChallengeEntries` 200 | `member_only` 403, cursor 422 |
| `GET /v2/entries/{id}/comments` | `cursor` | `EntryCommentPage` 200 | `member_only` 403, `entry_not_found` 404 |
| `POST /v2/entries/{id}/comments` | `EntryCommentCreateRequest`(request_id·body 필수) | `EntryComment` 201, 같은 요청 재전송 200 | `member_only` 403, `entry_not_found` 404, 길이 422, `request_fingerprint_mismatch` 422, `daily_comment_limit` 429 |
| `DELETE /v2/comments/{id}` | id | 204 | `member_only` 403, `comment_not_found` 404 |
| `GET /v2/public/entries/{id}` (공유 링크 미리보기, 로그인 없음, 웹 서버가 부름) | id, `X-Forwarded-For` | `PublicChallengeEntry` 200 | `entry_not_found` 404, 429(IP별 분당 60회) |

## 상태
entry_comments.status와 삭제 표시(deleted_at). entry_likes·entry_saves는 행이 있거나 없을 뿐 상태가 없다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| visible | 작성. hidden에서 신고 판정 restored·dismissed이고 남은 received 신고 없음 | challenge.react, challenge.report |
| hidden | visible 댓글의 유효한 첫 신고 | challenge.report |
| 삭제(deleted_at, body NULL) | 본인 삭제. 부모 참여작 삭제 | challenge.react, challenge.entry |

- 불변 조건: status는 visible·hidden뿐이다(`ck_entry_comments_status`). 삭제 ⇔ body NULL(`ck_entry_comments_deleted`). (user_id, request_id) 유일
  (`uq_entry_comments_request`).
- 끝 상태: 삭제. 삭제는 status를 바꾸지 않고 본문만 파기한다.

## 규칙·제약
- 반응은 개인 노출 조건을 만족하는 참여작에만 된다. 비공개·삭제·숨김 참여작, review·hidden 챌린지의 참여작, 차단 관계의 참여작에는 404다
  (공통 규칙). 반응 저장은 참여작·차단 행을 잠근 채 조건을 다시 확인한다.
- 좋아요는 자기 참여작에 할 수 없다(422 self_like). PUT·DELETE는 멱등이다. 두 번 켜도 하나, 없는 것을 꺼도 200. 좋아요 수는 연결 행을
  재집계한다. 종료된 챌린지의 참여작에도 좋아요·취소는 되되 최종 순위는 바뀌지 않는다.
- 저장은 다른 사람의 참여작을 다시 찾기 위한 개인 북마크다. 자기 참여작은 저장할 수 없다(422 self_save). PUT·DELETE는 멱등이다. 랭킹·작성자
  알림에 반영하지 않는다. 저장한 영상(A15.5)은 저장순이고 "내 영상 N · 저장한 영상 N"을 보여 준다. 저장한 참여작이 비공개·운영 숨김이면 목록에서
  빠지고 행은 남는다(다시 공개되면 돌아온다). 참여작이 삭제되면 저장 행도 삭제된다.
- 댓글은 공백 정리 뒤 1~500자의 일반 글이고 한 겹(답글 없음)이다. request_id·지문으로 멱등((user_id, request_id) 유일). 자기 참여작에도 쓸 수
  있다. 하루 100개까지(429 daily_comment_limit). 최신순 20개씩 이어 받고 댓글의 개인 노출 조건(머리말)을 쓴다. 수정은 없고 본인 삭제만 된다
  (본문 파기, deleted_at, 목록에서 제외). 작성자 이름은 현재 프로필 이름이고 이름을 바꾸면 옛 댓글도 새 이름으로 보인다. 탈퇴한 작성자는
  "탈퇴한 사용자". 댓글 응답에 이름 이외의 프로필 정보는 넣지 않는다. 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로 나에게만 보이고 지울
  수 있다.
- 참여작 작성자에게 좋아요·댓글 알림이 간다(challenge.notification). 차단 관계면 반응 자체가 404라 알림이 없다.
- 공유는 참여작 딥링크다. 회원 앱에서 열면 노출 조건을 확인한 뒤 그 참여작의 피드를 연다. 웹 주소(`/e/<id>`)는 메신저
  미리보기와 "앱에서 보기"만 있는 중간 페이지다 — 작품·대사(배역)만 보이고 영상·작성자 이름·사진은 없다. 공개 조건을
  벗어난 참여작은 "찾을 수 없어요"다(challenge.share, `GET /v2/public/entries/{id}`).
- 앱이 먼저 바꾼 좋아요 표시가 서버에서 실패하면 서버 상태로 되돌리고 알린다.
- 게스트: 403 member_only.

## 예외
- 비공개·삭제·숨김 참여작에 좋아요·저장·댓글: 404. 차단 관계: 404.
- 자기 참여작 좋아요: 422 self_like. 자기 참여작 저장: 422 self_save.
- 댓글 501자·빈 댓글: 422. 하루 101번째: 429 daily_comment_limit.
- 다른 사람의 댓글 삭제: 404.
- 저장한 참여작이 삭제됨: 목록에서 빠진다.

## 검증 방법
- 좋아요 PUT 두 번: entry_likes 1행, 좋아요 수 1. DELETE: 0행, 다시 DELETE: 200.
- 자기 참여작 좋아요: 422 self_like. 비공개 참여작: 404. 삭제된 참여작: 404. review 챌린지의 참여작: 404. 내가 차단한 사람의 참여작: 404. 나를
  차단한 사람의 참여작: 404.
- 종료된 챌린지 참여작에 좋아요: 200, 좋아요 수 +1, final_like_count·final_rank 그대로.
- 앱에서 좋아요를 먼저 표시한 뒤 서버 실패: 표시가 서버 값으로 돌아가고 안내가 뜬다.
- 저장 PUT 두 번: entry_saves 1행. DELETE 두 번: 200. A15.5 목록: 저장순. 자기 것: 422 self_save. 그 참여작이 비공개로 바뀜: 목록에 없고 행은
  있다. 다시 공개: 돌아온다. 참여작 삭제: 행 없음. 저장은 알림을 만들지 않는다.
- 댓글 작성: entry_comments 1행(request_id), 목록 최신순 20개씩, 작성자 이름 = 프로필 이름, 응답에 사진·소개·경력 없음. 같은 요청 id 재전송: 행
  하나. 이름 변경 뒤: 새 이름. 빈 댓글·공백만: 422. 500자: 200. 501자: 422. 자기 참여작에 댓글: 200. 하루 101번째: 429 daily_comment_limit.
- 본인 댓글 삭제: 본문 NULL, deleted_at, 목록에 없음. 남의 댓글 삭제: 404. 신고로 숨겨진 내 댓글: 나에게 "확인 중"으로 보이고 삭제된다.
- 작성자 탈퇴: 댓글 남고 "탈퇴한 사용자".
- 공유 링크를 회원 앱에서 열기: 그 참여작부터 피드가 열린다. 비공개된 뒤 열기: "볼 수 없는 영상" 안내.
- 게스트 토큰: 403 member_only.

## 범위 밖
- 댓글 좋아요·답글([공통 규칙](../common.md#범위-밖)).
- 댓글 수정.
- 저장의 랭킹·작성자 알림 반영.

