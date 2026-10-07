# 앱 연습 흐름

연습 화면을 앱에 옮긴 대응과, 옮기면서 정한 규칙을 적어 둔다. 화면을 고칠 때 어디를 건드리는지 알 수 있게 하는 것이
목적이다. 화면 번호는 pen의 것이다. 옛 목업의 M 번호는 각 기능 스펙의 `화면`
줄에 대응 화면으로 남아 있다. Practice Stage 이름은 [ARCHITECTURE 「연습 화면의 전환」](../../../docs/ARCHITECTURE.md#연습-화면의-전환),
화면이 지키는 규칙은 [연습 스펙](../../../docs/specs/practice/README.md)에 있다.

## 화면 대응표

| pen | 앱 파일 | 하는 일(Practice Stage) |
|---|---|---|
| A8 · A8.1 · A9.1 · A9.2 · A9.3 | `app/upload.tsx` | 준비, 막힘 선택. 영상 고르기 → 장면 적기 → 막힘 고르기가 **한 화면의 여러 상태**다 |
| A10 | `app/analyzing.tsx` | 분석. 끝나면 대화로 넘어간다 |
| A11 · A11.1 | `app/coach.tsx` | 대화 |
| A13 | `app/report.tsx` | 연습 노트(방금 끝낸 회차). "다음 연습"은 준비 화면으로 간다 |
| A12 | `app/report-detail.tsx` | 지난 연습 노트(연습 기록에서 연다) |
| A1.1 · A1.2 | `app/(tabs)/history.tsx` · `app/practice-group.tsx` | 연습 기록과 묶음 상세. "이어서 연습하기"는 준비 화면으로, 진행 중 회차는 분석 화면으로 간다 |

업로드는 연습 화면에 없다. 준비 화면은 보관함의 영상을 고르기만 하고, 올리기는 보관함의 올리기 큐
(`lib/library/library-runner.ts`)가 한다(practice.record).

만들지 않은 것:

- **분석 확인 대화·확정(옛 목업 M7.1-R·M7.2-R)** — 기존 갈래 전용 화면이다(practice.coach). 앱은 분석이 끝나면 대화로 곧장 간다.
- **세션 목록 드로어(옛 목업 M8-R)** — 앱은 탭 구조라서 드로어를 넣으면 이동 경로가 둘이 된다. 지난 연습은 연습 기록(A1.1)에서 본다.

## 머리 부분과 '영상·장면 보기'

연습 화면들은 머리 부분(스텝퍼 `Stepper`, 진행 줄 `ProgressRow`, '영상 보기' 접이식 `SceneFoldLink`·`SceneFoldBody`)을
`components/practice-chrome.tsx` 한곳에서 가져다 쓴다 — 화면마다 다시 만들면 간격과 색이 조금씩 어긋난다.

접이식이 **링크와 본문 두 조각으로 나뉘어 있는 이유**:

```
ProgressRow(right: SceneFoldLink)   ← 좁은 가로 줄
SceneFoldBody                       ← 화면 전폭
```

진행 줄은 좁은 가로 칸이라, 영상을 그 안에 넣으면 갇혀서 찌그러진다. 그래서 펼침
상태는 화면이 들고(`sceneOpen`), 본문은 진행 줄 **아래**에 전폭으로 그린다.

링크는 작은 글자가 화면 오른쪽 끝에 붙어 있어서 손가락으로 글자만큼 정확히 짚을 수 없다. 누르는 칸은 `hitSlop`으로
글자보다 넓힌다.

### 영상 출처

| 화면 | 출처 |
|---|---|
| `analyzing` | 보관함의 기기 복사본(`localCopyFor`) → 없으면 서버 재생 주소 |
| `coach` · `report` | `practice.videoUri` → 없으면 `practice.playbackUrl` |

## 개발용 UI 미리보기

영상 업로드와 Gemini 분석을 지나지 않고 연습 화면을 여는 통로. **개발 빌드에서만**
열린다 (`__DEV__`).

- 들어가는 곳: 설정 → `UI 미리보기 (개발용)`
- 딥링크: `actingapp://ui-preview`, `actingapp://ui-preview?go=<analyzing|coach|report>`

가짜 장면·가짜 연습은 `lib/ui-preview.ts` 에 있고, 서버에는 아무것도 보내지 않는다 —
화면이 읽는 모듈 스토어만 채운다.

접이식에 그릴 영상이 없으면 "다시 볼 수 있는 영상이 없어요" 만 떠서 화면이 고장난
것처럼 보인다. 그래서 테스트 패턴 4초(`assets/dev/sample-take.mp4`, 75KB)를 함께
둔다. 실제 테이크로 착각하지 않도록 일부러 색 막대 패턴을 쓴다.

**`__DEV__` 확인은 `lib/preview-video.ts` 한 곳에서만 한다.** 화면마다 가드를 두면
한 군데를 빼먹었을 때 배포 빌드에 가짜 영상이 뜬다.

## 웹과 맞춰야 하는 것

막힘 값(큰 갈래·세부)은 서버가 받는 값과 **글자까지 같아야 한다.** 값 목록은
[practice.start](../../../docs/specs/practice/start.md#규칙제약)에 있고, 앱은 `app/upload.tsx`·`lib/practice/types.ts`,
웹은 `blockage-flow.ts`가 들고 있다. 서버가 이 값으로 코치를 가르므로(분석/표현), 플랫폼마다 다른 값을 보내면 같은 배우가
기기에 따라 다른 질문을 받는다.

## 검증

검증 명령은 CI의 `mobile` 잡([ci.yml](../../../.github/workflows/ci.yml))을 따른다.

화면 확인은 시뮬레이터에서 위 딥링크로 한다.

```
xcrun simctl openurl booted "actingapp://ui-preview?go=report"
xcrun simctl io booted screenshot out.png
```

터치를 명령으로 넣을 방법은 없다(`simctl` 에 tap 이 없고, `osascript` 좌표 클릭은
보조 접근 권한이 필요하다). 누르는 동작은 손으로 확인해야 한다.
