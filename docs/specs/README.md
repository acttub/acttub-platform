# 기능 스펙

**작성 중.** 지금 쓰는 것은 1.0.0 목표 상태이고, 배포된 제품의 동작은 아직 `docs/PRD.md`가 말한다.
네 영역을 다 쓰면 루트 CLAUDE.md의 조건부 정본에 이 폴더를 넣는다.

기능마다 무엇을 하고, 왜 하고, 실패하면 어떻게 되고, 어떻게 확인하는지를 적는 문서 묶음이다.
1.0.0에서는 스키마의 컬럼과 API를 정하는 근거가 된다. 테이블과 관계는 ERD에서 합의했다.

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
| [커뮤니티 (상태: 후속)](community/README.md) | — |

## 쓰는 법

기능 하나가 `<영역>/<기능>.md` 파일 하나이고, 아래 틀을 따른다. 기본 절은 다섯이고, 나머지 절은 필요할 때만 붙인다.

```markdown
# <영역>.<기능> <기능 이름>
- 도입: <판>
- 화면: <pen 화면 번호>
- 테이블: <ERD 테이블명>

## 기능
## 의도
## 목적
## 예외
## 검증 방법
```

- **id**: `<영역>.<기능>`, 영문 소문자와 하이픈만 쓴다. 이슈·테스트·ADR에서 이 id로 가리킨다.
- **도입**: 이 기능 id가 요구사항에 처음 들어간 판. 이미 있던 기능도 이 문서 묶음이 시작된 1.0.0으로
  적는다. 뒤에 규칙이 바뀌어도 이 줄은 그대로 둔다.
- **상태**: 판에서 뺀 기능에만 `- 상태: 후속`을 적는다. 버린 요구사항은 `docs/archive/`로 옮긴다.
- **결정 기록**: 이 기능에 닿는 ADR 번호. 있을 때만 적는다.
- **화면**: pen 파일의 화면 번호. 예: A1.2, A8.1. 아직 없으면 비워 둔다.
- **테이블**: ERD의 테이블명. 이 줄로 요구사항이 없는 테이블을 찾는다.
- **기능**: 무엇을 하는지 한두 문장.
- **의도**: 왜 넣는지. 어떤 문제나 상황에서 출발했는지.
- **목적**: 배우가 얻는 결과. 성공한 상태를 문장으로 쓴다.
- **예외**: 실패·중단·되돌리기·탈퇴 때 어떻게 되는지.
- **검증 방법**: 완료를 확인하는 방법. 무엇을 넣으면 무엇이 나와야 하는지.

필요할 때만 붙이는 절: 행위자·진입점, 흐름(상태 전이), 데이터(저장·조회·공개 범위), 규칙·제약,
완료 조건, 범위 밖, 열린 질문.

(결정 필요)가 붙은 문장은 권장안이다. 사용자가 정하면 표시를 떼고 그 문장이 규칙이 된다. 구현은
표시가 떼진 문장만 따른다.

기능 하나가 끝난 기준: 다섯 절이 다 있고, 테이블 줄의 이름이 전부 ERD에 있고, 검증 방법의 각
항목이 입력과 기대 결과 한 쌍이고, (결정 필요)가 남아 있지 않다. 문서 묶음이 끝난 기준: ERD의
테이블과 [공통 규칙](common.md)의 "ERD에 반영할 변경"의 추가 테이블이 모두 어느 기능의 테이블 줄에 나온다. 구현이 끝난 기준: 검증 방법의 항목마다
테스트 하나가 대응한다.
