# 앱 연습 흐름 (목업 M4 ~ M9)

`목업-2026-08-03.pen` 을 앱에 옮긴 결과와, 옮기면서 정한 규칙을 적어 둔다. 화면을
고칠 때 목업을 다시 열지 않아도 어디를 건드리는지 알 수 있게 하는 것이 목적이다.

## 화면 대응표

| 목업 | 앱 파일 | 하는 일 |
|---|---|---|
| M4 · M5 | `app/upload.tsx` | 영상 고르기 → 장면 적기. **한 화면의 두 상태**다. 목업에서도 화면이 나뉘어 있지 않다 |
| M6.1-R · M6.1.1-R · M6.2-R | `app/blockage.tsx` | 막히는 지점 3단계 (대분류 → 세부 → 서술) |
| M6.3-R | `app/analyzing.tsx` | 분석 진행 |
| M7-R | `app/coach.tsx` | 질문 대화 |
| M7.2-R | `app/report.tsx` | 분석 결과 카드 |
| M9-R | `app/report-detail.tsx` | 연습 노트 |

만들지 않은 것:

- **M7.1-R 분석 확인** — 서버가 `status === 'complete'` 와 함께 카드를 바로 준다.
  중간 확인 단계를 앱에서 만들면 계약에 없는 화면이 하나 늘어난다. 웹도 같은 이유로
  카드로 곧장 넘어간다.
- **M8-R 세션 목록 드로어** — 앱은 탭 구조라서 드로어를 넣으면 이동 경로가 둘이 된다.
  구조를 먼저 정해야 해서 미뤘다.

## 진행 줄과 '영상·장면 보기'

막히는 지점 · 분석 진행 · 분석 결과 세 화면이 같은 머리 부분을 쓴다.
`components/practice-chrome.tsx` 한곳에 둔다 — 화면마다 다시 만들면 간격과 색이
조금씩 어긋난다.

접이식이 **링크와 본문 두 조각으로 나뉘어 있는 이유**:

```
ProgressRow(right: SceneFoldLink)   ← 좁은 가로 줄
SceneFoldBody                       ← 화면 전폭
```

진행 줄은 좁은 가로 칸이라, 영상을 그 안에 넣으면 갇혀서 찌그러진다. 그래서 펼침
상태는 화면이 들고(`sceneOpen`), 본문은 진행 줄 **아래**에 전폭으로 그린다.

누르는 칸은 글자보다 넓다. 라벨이 12px 인데 화면 오른쪽 끝에 붙어 있어서, 손가락으로
글자만큼 정확히 짚을 수 없다. `padding` 으로 넓히고 같은 크기의 **음수 margin** 으로
되돌려, 진행 줄 높이는 목업 그대로 두면서 터치 면적만 키운다.

### 영상 출처

| 화면 | 출처 |
|---|---|
| `blockage` | `peekPendingUpload()?.video.uri` |
| `analyzing` | 업로드 대기물의 로컬 원본 |
| `report` | `practice.videoUri` → 없으면 `practice.playbackUrl` |

`peekPendingUpload()` 가 따로 있는 이유: `takePendingUpload()` 는 꺼내면서 비운다.
막히는 지점 화면이 그걸로 읽으면 다음 화면(분석)이 대기물을 못 받아 업로드로
되돌아간다.

## 개발용 UI 미리보기

영상 업로드와 Gemini 분석을 지나지 않고 연습 화면을 여는 통로. **개발 빌드에서만**
열린다 (`__DEV__`).

- 들어가는 곳: 설정 → `UI 미리보기 (개발용)`
- 딥링크: `actingapp://ui-preview`, `actingapp://ui-preview?go=<blockage|analyzing|coach|report>`

가짜 장면·가짜 카드는 `lib/ui-preview.ts` 에 있고, 서버에는 아무것도 보내지 않는다 —
화면이 읽는 모듈 스토어만 채운다.

접이식에 그릴 영상이 없으면 "다시 볼 수 있는 영상이 없어요" 만 떠서 화면이 고장난
것처럼 보인다. 그래서 테스트 패턴 4초(`assets/dev/sample-take.mp4`, 75KB)를 함께
둔다. 실제 테이크로 착각하지 않도록 일부러 색 막대 패턴을 쓴다.

**`__DEV__` 확인은 `lib/preview-video.ts` 한 곳에서만 한다.** 화면마다 가드를 두면
한 군데를 빼먹었을 때 배포 빌드에 가짜 영상이 뜬다.

## 웹과 맞춰야 하는 것

`lib/blockage.ts` 의 선택지 값은 웹 `blockage-flow.ts` 와 **글자까지 같아야 한다.**
서버가 이 값으로 코치를 가르므로(분석/표현), 플랫폼마다 다른 값을 보내면 같은 배우가
기기에 따라 다른 질문을 받는다.

## 검증

```
cd apps/mobile
npx tsc --noEmit -p .
npx expo lint
node tests/index.mjs
```

화면 확인은 시뮬레이터에서 위 딥링크로 한다.

```
xcrun simctl openurl booted "actingapp://ui-preview?go=report"
xcrun simctl io booted screenshot out.png
```

터치를 명령으로 넣을 방법은 없다(`simctl` 에 tap 이 없고, `osascript` 좌표 클릭은
보조 접근 권한이 필요하다). 누르는 동작은 손으로 확인해야 한다.
