# 기능 스펙

기능 행동(권한·오류 코드·한도·응답의 뜻·상태 전이)의 정본이다(루트 CLAUDE.md 「조건부 정본」). 0.1.0 기준으로 쓰고,
구현 규칙은 [CONTRACT](../../apps/api/CONTRACT.md)의 같은 기능 절에 둔다. 코드와 어긋나면 코드를 확인해 틀린 쪽을 고친다.

기능마다 무엇을 하고, 왜 하고, 실패하면 어떻게 되고, 어떻게 확인하는지를 적는 문서 묶음이다.
0.1.0에서는 스키마의 컬럼과 API를 정하는 근거가 된다. 테이블과 관계는 ERD에서 합의했다.

요구사항은 경로에 판을 두지 않고 그 자리에서 고친다. 판은 기능의 `도입` 줄이 말하고, 지난 상태는
git 이력이 보관한다. 동작을 바꾸는 PR이 그 기능의 요구사항도 함께 고친다.

## 관련 정본

- ERD 결정 기록: 워크트리의 `.scratch/SOMA-528.md`(추적되지 않음),
  ERD 아티팩트 https://claude.ai/code/artifact/7161a549-3af9-4adf-99af-39798fabd10c
- 화면 정본: https://github.com/acttub/pen 의 `acttub 디자인.pen`
- 제품 범위·API·DB 규칙은 루트 CLAUDE.md의 조건부 정본을 따른다.

## 읽는 순서

[공통 규칙](common.md)을 먼저 읽고, 영역 폴더의 `README.md`(영역 개요와 영역 전체에 걸친 표) 다음에 기능 파일을 읽는다.
기능 목록은 각 영역 폴더의 파일이 정본이다. 기능 id(`account.login`)는 파일 첫 줄 제목에 있다.

| 영역 | 기능 |
|---|---|
| [계정](account/README.md) | [account.login 로그인·자동 가입](account/login.md)<br>[account.consent 동의 조회·변경](account/consent.md)<br>[account.profile 프로필](account/profile.md)<br>[account.portfolio 포트폴리오](account/portfolio.md)<br>[account.notification 알림 설정·발송](account/notification.md)<br>[account.logout 로그아웃](account/logout.md)<br>[account.guest 웹 체험과 앱으로 옮기기](account/guest.md)<br>[account.withdraw 탈퇴](account/withdraw.md) |
| [연습](practice/README.md) | [practice.record 촬영·보관](practice/record.md)<br>[practice.library 보관함](practice/library.md)<br>[practice.start 코칭 시작](practice/start.md)<br>[practice.resume 이어하기](practice/resume.md)<br>[practice.analyze 분석](practice/analyze.md)<br>[practice.coach 코치 대화](practice/coach.md)<br>[practice.note 연습 노트](practice/note.md)<br>[practice.memory 배우 기억](practice/memory.md)<br>[practice.feedback 이탈 설문](practice/feedback.md) |
| [대본 리딩](reading/README.md) | [reading.script 대본 등록](reading/script.md)<br>[reading.cast 배역](reading/cast.md)<br>[reading.session 리딩 회차](reading/session.md)<br>[reading.recording 녹음](reading/recording.md)<br>[reading.memorization 암기](reading/memorization.md) |
| [챌린지](challenge/README.md) | [challenge.create 개설](challenge/create.md)<br>[challenge.browse 둘러보기·랭킹](challenge/browse.md)<br>[challenge.entry 참여](challenge/entry.md)<br>[challenge.react 좋아요·저장·댓글](challenge/react.md)<br>[challenge.block 사용자 차단](challenge/block.md)<br>[challenge.report 신고](challenge/report.md)<br>[challenge.ai-report AI 리포트](challenge/ai-report.md)<br>[challenge.notification 챌린지 알림·알림함](challenge/notification.md) |
| [커뮤니티 (진행: 후속)](community/README.md) | — |

## 쓰는 법

기능 하나가 `<영역>/<기능>.md` 파일 하나이고, 아래 틀을 따른다. 필수 절은 아홉이고 이 순서로 쓴다.
열린 질문만 있을 때 붙인다.

```markdown
# <영역>.<기능> <기능 이름>
- 도입: <판>
- 화면: <pen 화면 번호>
- 테이블: <ERD 테이블명>

## 기능
## 의도
## 목적
## 입력·출력
## 상태
## 규칙·제약
## 예외
## 검증 방법
## 범위 밖
## 열린 질문
```

- **id**: `<영역>.<기능>`, 영문 소문자와 하이픈만 쓴다. 이슈·테스트·ADR에서 이 id로 가리킨다.
- **도입**: 이 기능 id가 요구사항에 처음 들어간 판. 이미 있던 기능도 이 문서 묶음이 시작된 0.1.0으로
  적는다. 뒤에 규칙이 바뀌어도 이 줄은 그대로 둔다.
- **진행**: 판에서 뺀 기능에만 `- 진행: 후속`을 적는다. 버린 요구사항은 지우고 git 이력에 맡긴다.
- **결정 기록**: 이 기능에 닿는 ADR 번호. 있을 때만 적는다.
- **화면**: pen 파일의 화면 번호. 예: A1.2, A8.1. 아직 없으면 비워 둔다.
- **테이블**: ERD의 테이블명. 이 줄로 요구사항이 없는 테이블을 찾는다.
- **기능**: 무엇을 하는지 한두 문장. 배우가 보는 동작으로 쓴다.
- **의도**: 왜 넣는지. 어떤 문제나 상황에서 출발했는지.
- **목적**: 배우가 얻는 결과. 성공한 상태를 문장으로 쓴다.
- **입력·출력**: 기능의 입구를 표 하나로 적는다. 필드 전체는 옮기지 않고 `apps/api/spec/openapi.json`의
  스키마 이름으로 가리킨다. HTTP가 아닌 입구(예약 작업·비동기 작업·푸시)도 같은 표에 적고, 입구가 없으면
  "없음 — <이유>"라고 쓴다.

  | 입구 | 입력 | 출력 | 오류 |
  |---|---|---|---|
  | `POST /v2/practices` | 헤더·필수 필드 | `Practice` 201 | `video_not_ready` 422, … |
  | `AnalysisWorkerScheduler.poll` (주기 설정값) | `pending` 분석 작업 | 분석 결과 저장 | 3회 실패 시 `failed` |

- **상태**: 이 기능이 다루는 행이 거치는 상태다(DDD의 aggregate 생애). 상태 표는 그 행을 **만드는 기능
  한 곳**에만 두고 정본으로 삼는다. 상태를 바꾸기만 하는 기능은 자기가 일으키는 전이 한두 줄과 정본 링크를
  적는다. 다루는 상태가 없으면 "없음"이라고 쓴다.

  | 상태 | 들어오는 전이(조건) | 일으키는 기능 |
  |---|---|---|
  | analyzing | 시작, 닫힌 회차 재시도 | practice.start |

  표 아래에 불변 조건(예: 묶음당 closed가 아닌 회차는 하나 — `uq_practices_open_root`)과 끝 상태를 적는다.
- **규칙·제약**: 지켜야 할 규칙과 기술 경계(한도·시간·권한). 락 순서·트랜잭션 경계·원장 같은 구현 규칙은 스펙에
  두지 않고 [CONTRACT](../../apps/api/CONTRACT.md)의 해당 기능 절(§6-5 이후)에 둔다.
- **예외**: 실패·중단·되돌리기·탈퇴 같은 엣지 케이스에서 어떻게 되는지.
- **검증 방법**: 수용 기준이다. 항목마다 무엇을 넣으면 무엇이 나와야 하는지 한 쌍으로 쓴다.
- **범위 밖**: 이 기능에서 하지 않는 것. 에이전트가 넘치게 만드는 것을 막는 선이다. 없으면 "없음"이라고 쓴다.
- **열린 질문**: 정해지지 않았거나 문서와 코드가 어긋난 것. 해소하면 지운다.

(결정 필요)가 붙은 문장은 권장안이다. 사용자가 정하면 표시를 떼고 그 문장이 규칙이 된다. 구현은
표시가 떼진 문장만 따른다.

기능 하나가 끝난 기준: 필수 아홉 절이 순서대로 있고, 테이블 줄의 이름이 전부 ERD에 있고, 검증 방법의 각
항목이 입력과 기대 결과 한 쌍이고, (결정 필요)가 남아 있지 않다. 문서 묶음이 끝난 기준: ERD의
테이블과 [공통 규칙](common.md)의 "ERD에 반영할 변경"의 추가 테이블이 모두 어느 기능의 테이블 줄에 나온다. 구현이 끝난 기준: 검증 방법의 항목마다
테스트 하나가 대응한다.
