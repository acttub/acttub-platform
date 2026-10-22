# practice.memory 배우 기억

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: A4.1(코치가 기억하는 것), D14, WM, A4(프로필의 진입점), 이관 기억 선택 팝업(account.guest, 미설계)
- 테이블: actor_memories, ai_jobs

## 기능
배우 한 사람에 대해 연습을 가로질러 남는 값(목표·막히는 지점·화법 둘)을 코치가 연습에서 뽑아 적고, 배우가 직접 보고 고친다.
배우가 고친 값은 코치가 다시 바꾸지 않는다. 다음 연습의 코치가 이것을 알고 시작한다.

## 의도
Actor Memory의 자리는 연습 도구의 성능이다(PRD). 현행 규칙(배우 우선, 출처 구분, 개인 심리 판정 금지, 1·3·6회 갱신)은
그대로고 성별·나이는 프로필로 옮긴다(account.profile). 저장은 (user_id, field) 유일인 actor_memories다.

## 목적
코치가 지난 연습에서 알아낸 것을 알고 시작해 같은 이야기를 다시 묻지 않고, 배우가 틀린 기억을 바로잡는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/me/memory` | — | `ActorMemoryResponse` 200 (말투 tone 은 빼고 내려보낸다) | — |
| `PUT /v2/me/memory/{field}` | field(goal·blockage·wants·habits·avoid·speech_self·speech_actual, tone 은 422), 필수 `value` 1~1,000자 (`UpdateActorMemoryRequest`) | `ActorMemoryItem` 200(written_by actor) | 1,001자·없는 field 422(배열), `account_deactivated` 403 |
| `DELETE /v2/me/memory/{field}` | field | 204, 이미 없어도 204 | 없는 field 422(배열) |
| `DELETE /v2/me/memory` | — | 204 | — |
| `GET·DELETE /v2/legacy-me/memory`, `PUT·DELETE /v2/legacy-me/memory/{field}` | 옛 표(actor_memory_entries)의 옛 경로 (`UpdateMemoryRequest`) | `MemoryResponse`·`MemoryItem` 200, 204 | 422(배열) |
| `ActorMemoryUpdateScheduling.onConversationClosed` | 닫힌 회차 | avoid(그 장면의 행)에 정정 덧붙임, 끝난 대화마다 ai_jobs memory_update `pending`(SOMA-795), 예약 시점의 memory_epoch | — |
| `ActorMemoryUpdateWorker.sweepIdle` (10분마다) | 배우가 두 번 이상 답하고 30분~24시간 말이 없는 열린 회차, 작업이 아직 없는 것 | 위와 같다 | — |
| `MemoryWorkerScheduler.poll` (`ANALYSIS_WORKER_POLL_INTERVAL_SEC`, 기본 2초) | `pending` memory_update 작업 | actor_memories 갱신(written_by agent, 배우가 쓴 칸은 건너뜀) | 세대 불일치 `failed`/memory_epoch_stale, 탈퇴 `failed`/account_deactivated, 3회 소진은 분석 워커 정리가 닫는다 |

## 상태
users.memory_epoch — 기억 세대.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| 세대 0 | 계정 생성 | — |
| 세대 +1 | 항목·전체 삭제, 게스트 이관에서 기억 선택 | practice.memory, account.guest |

- 불변 조건: 세대는 줄지 않는다. 갱신 작업은 예약 시점 세대를 갖고, 완료 때 세대가 다르면 아무것도 쓰지 않고 작업을
  failed/memory_epoch_stale로 닫는다 — 늦은 갱신, 삭제 전에 예약만 된 작업, 이관에서 버린 쪽의 작업이 기억을 되살리거나 덮지 못한다.
  삭제는 멱등이고 누적 횟수를 초기화하지 않는다. "다음 연습부터 다시 쌓인다"는 다음 갱신 대상 회차부터라는 뜻이다.
- 끝 상태: 없음.

memory_update 작업의 전이 (정본: [공통 상태](../common.md#공통-상태))

## 규칙·제약
- 항목(유저.md, SOMA-603): goal(목표)·blockage(막히는 지점)·wants(코치에게 바라는 것)·habits(자주 짚인 버릇, 서술형)·
  avoid(다시 말하지 않을 것)·tone(말투). tone 은 코치만 쓰고 배우 화면·API 읽기에 내려보내지 않는다. 옛 speech_self·speech_actual 은
  더 채우지 않고 연습 루프 코치에도 싣지 않지만, 스토어에 나간 앱이 보여 주므로 읽기·쓰기는 남긴다. 성별·나이 칸은 기억 화면에서
  빼고 프로필로 안내한다.
- 모델(추출기)은 goal·blockage·wants·habits·tone 만 쓴다. avoid 는 회차가 끝날 때(또는 말이 끊긴 열린 회차를 볼 때) 코드가
  연습 루프 상태 칸의 정정·반박을 "- 주제: \"원문\"" 줄로 덧붙인다 — 같은 줄은 다시 넣지 않고 12줄을 넘으면 오래된 것부터 뺀다.
  추출기 재료에는 세션.md 한 줄과, 배우 말마다 코치가 붙인 분류("(평가 요청) …")가 들어간다.
- 배우가 직접 적거나 고친 값은 written_by = actor이고 워커(memory_update)가 덮지 않는다. 화면에 "내가 적은 값"을 표시한다. 값은
  공백을 정리한 뒤 1~1,000자이고, 다듬고 나서 빈 값은 422(배열, `value must not be blank`)다.
- 자동 갱신의 근거는 배우 발화·실제 전사·관찰만이다. 코치 제안이나 인물 대사를 배우의 성격으로 바꾸지 않고 개인 심리를 판정하지
  않는다(현행 추출기).
- 갱신 시점: 끝난 대화마다(SOMA-795, 예전에는 1·3·6·9…번째만이라 자주 연습하는 배우의 기억이 낡았다). 끝난 대화는 action·observation
  노트가 남은 회차와, 열린 채 남았어도 배우가 두 번 이상 답한 회차다(SOMA-603, record_only 는 세지 않는다).
- 범위(SOMA-795): 목표(goal)·다시 말하지 않을 것(avoid)은 장면 단위다 — `actor_memories.scene_root_id`(= practices.root_id)에 붙고
  코치는 같은 root 회차에서만 읽는다. 배우가 장면 없이 쓴 값은 어디서나 읽는다. 나머지 칸과 맞춤 코칭(coaching_profile)은 배우 단위다.
  화면 목록은 칸마다 한 줄(배우가 쓴 행, 없으면 최근 행)이다. 화면 선택·코치 진행을 적은 값("…지점을 골랐다", "…지적이 있었고")은
  저장하지 않고 이미 있는 것도 읽지 않는다(MeaningfulMemoryValue).
- 맞춤 코칭(coaching_profile, SOMA-795): 자문위원 7명 파일에서 뽑은 칸을 JSON 으로 저장한다(ActorCoaching) — 막혔을 때 방식(choice·
  propose_one·easier_open), 첫 질문 틀, 정리 틀, 쓰지 않을 말, 이유 먼저, 물으면 바로 답하기, 정리 전 질문 수 상한(2~4), 원하는
  피드백 쪽(root·method·both), 짚지 않을 것, 답 길이(60~160). 갱신 때마다 최근 대화 8개(60일)·노트 평가·정정으로 근거가 있는 칸만
  다시 정하고, 근거 없는 칸은 비운다(공통 동작). 진단·장면 내용·장면 해석·공통 금지(양자택일 권장, 확인하며 등, 칭찬, 시키는 말)는
  걸러 낸다. 자문위원 파일이 없는 배우의 연습 루프에서 코치는 (a) 단계 지시를 바꿔 끼우고(쉽게 묻기·스스로 찾기·어긋남 보기의 둘 중
  고르기, 첫 질문 모양, 정리 모양, 쓰지 않을 말이 든 공통 줄 빼기, 답하기 강화) (b) 자문위원 파일 모양의 글을 성격 자리(actor-profile)에
  붙이고 (c) 질문 수 상한에 닿으면 묻는 할 일 대신 정리로 넘기며 길이를 [길이]로 묶는다. 예전(#856) 글 형식 값은 글만 붙는다.
  배우 화면에는 없다.
- 이관 때 어느 기억을 남길지는 [account.guest](../account/guest.md#규칙제약)가 정한다. 고른 뒤 세대를 올린다.
- 조회는 항목마다 값·작성자·출처 연습·수정 시각을 준다. 출처 연습이 숨겨졌으면 값은 그대로고 링크만 없다. 웹 게스트는 자기 기억만 보고,
  성별·나이 자리에는 프로필 편집 링크 대신 "앱으로 옮기면 프로필에서 적어요" 안내가 있다(게스트는 프로필이 없다).
- 0.1.0 데이터 전환 전의 기억은 옛 표(actor_memory_entries)에만 있다. 조회(화면·코치·추출기의 기존 값)는 새 표에 없는 네 칸(goal·blockage·speech_self·speech_actual)을 옛 표에서 읽고(호환 읽기, 출처 링크 없음), 항목·전체 삭제는 옛 표의 그 칸도 지운다. 워커는 옛 표에서 배우가 적은 칸을 덮지 않는다(SOMA-736).
- 탈퇴 때의 처리는 [연습 README 「연습 자료의 이관·삭제·탈퇴」](README.md#연습-자료의-이관삭제탈퇴)에 있다.

## 예외
- 워커가 대기 중일 때 배우가 같은 항목 수정: 워커 완료 뒤에도 배우 값·written_by = actor 유지.
- 삭제 직후 늦게 끝난 갱신, 삭제 전에 예약만 된 갱신: 반영되지 않는다. 이관에서 회원 기억을 고른 뒤 게스트 쪽 작업 완료: 덮지 않는다.
- 1,001자: 422.
- 기억 갱신 작업 실패: 재시도 규칙은 [공통 상태](../common.md#공통-상태)의 ai_jobs와 같고 사용자 화면에는 드러나지 않는다.

## 검증 방법
- 기존 갈래 확인 연습 1회 완료: ai_jobs memory_update 1행, 완료 뒤 actor_memories에 written_by = agent 값. 2회: 갱신 없음. 3회: 갱신. 6회·9회: 갱신.
- 신형 action 노트 회차 1개 완료: 확인 연습 1회로 세어 갱신. observation: 셈. record_only 회차: 세지 않는다.
- 배우가 goal을 적음: written_by actor. 그 뒤 워커 완료: 값 그대로.
- 전체 삭제 뒤 진행 중이던 워커 완료: 행이 생기지 않는다(세대 불일치). 삭제 전에 예약된 작업: 반영 없음. 삭제 뒤 누적 2회 → 3회째 확인 연습: 갱신.
- 항목 하나 삭제: 그 항목만 없고 다른 항목 그대로. 두 번 삭제: 204.
- 이관에서 회원 기억 선택 뒤 게스트에서 시작된 작업 완료: 회원 기억 그대로. 기억 없는 회원에게 이관: 게스트 기억이 그대로 옮겨진다.
- 출처 연습을 숨김: 값 그대로, 출처 링크 없음.
- 앱 기억 화면: 성별·나이 칸이 없고 프로필 링크가 있다. 웹 게스트 기억 화면: 프로필 링크 대신 앱 이관 안내. 1,000자: 200. 1,001자: 422.
- 기억이 있는 회원에게 기억 있는 게스트 이관: 409로 되묻고 고른 쪽만 남는다(account.guest 검증과 같다).

## 범위 밖
- 개인 심리 판정, 배우 개인 심리·트라우마를 파고드는 것(PRD 「지금 하지 않는 것」).
- 성별·나이 칸. 프로필로 옮긴다(account.profile).
