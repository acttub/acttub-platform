---
name: Acttub
version: 2026-11-25
source:
  colors: apps/mobile/constants/palette.ts (acttub-platform dev)
  type_radius_space: apps/mobile/constants/tokens.ts (acttub-platform dev)
  components: apps/mobile/components/ui/*.tsx
  pen: acttub-design-system.pen (변수 「색」「글자」「모서리·간격·그림자」)
colors:
  bg: "#FFFFFF"
  bg-soft: "#F2F4F6"
  bg-subtle: "#F9FAFB"
  border: "#E5E8EB"
  text: "#191F28"
  text-sub: "#4E5968"
  text-meta: "#6B7684"
  text-disabled: "#B0B8C1"
  icon-faint: "#8B95A1"
  blue: "#4880EE"
  blue-deep: "#3268D8"
  blue-soft: "#EAF3FE"
  blue-mask: "#BCD6F7"
  danger: "#E42939"
  danger-soft: "#FFF0F0"
  green: "#009959"
  green-soft: "#E5F8EF"
  amber: "#8A4B00"
  amber-soft: "#FFF8EC"
  flame: "#FF6B2C"
  flame-soft: "#FFF1E8"
  on-accent: "#FFFFFF"
  on-media-sub: "#FFFFFFB3"
  scrim: "#0F141E73"
  toast: "#191F28E6"
typography:
  font: Pretendard
  display:    { size: 28, line: 36, weight: 700 }
  title1:     { size: 24, line: 32, weight: 700 }
  title2:     { size: 20, line: 28, weight: 700 }
  headline:   { size: 17, line: 26, weight: 600 }
  body1:      { size: 16, line: 24, weight: 400 }
  body1-bold: { size: 16, line: 24, weight: 700 }
  body2:      { size: 14, line: 21, weight: 400 }
  body2-bold: { size: 14, line: 21, weight: 700 }
  caption:    { size: 13, line: 19, weight: 400 }
  caption-bold: { size: 13, line: 19, weight: 700 }
  micro:      { size: 12, line: 16, weight: 600 }
radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, full: 999 }
space: { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, gutter: 20 }
shadow-overlay: { color: "#000000", opacity: 0.16, radius: 18, y: 6, elevation: 10 }
---

# Acttub 디자인

배우·지망생이 혼자 연기를 연습하는 앱이다. 화면은 흰 바탕에 파랑 하나로 강조하는 조용한 연습실 톤이다. 마케팅 랜딩이 아니라 매일 쓰는 연습 도구처럼 보여야 하고, 주인공은 사용자의 영상과 대사다.

이 문서는 한 번에 읽는 요약이다. 정본은 [acttub/pen](https://github.com/acttub/pen)의 `acttub-design-system.pen`, [PRD 「디자인」](../../docs/PRD.md#디자인), 토큰 코드(`constants/palette.ts`, `constants/tokens.ts`)다. 이 문서와 정본이 다르면 정본이 맞고, 이 문서를 고친다. 화면 코드에 색·글자 크기·간격 숫자를 직접 적지 않는다(`tests/design-system.test.mjs`가 막는다).

## 1. 브랜드

- 이름: Acttub(액터브). 로고는 `apps/mobile/assets/images/logo-wordmark.png`.
- 로고 색(파일에서 뽑은 근사값): 「Act」 파랑 약 #0A61FB, 「tub」 남색 약 #1A2050, 반짝임 노랑 약 #F5C335. 로고 색은 로고에만 쓰고, 앱 화면 강조색은 `blue` 계열이다.
- 어두운 바탕(영상 위 등)에는 흰색 단색 로고를 쓴다.
- 마스코트 「액티」(`assets/images/acty/`)는 완료 화면, 안내 말풍선, 실패·권한 화면에만 나온다. 랜딩이나 홍보물을 마스코트 중심으로 만들지 않는다(사용자가 거절한 방향).

## 2. 색

| 쓰임 | 토큰 |
|---|---|
| 화면 바탕 | `bg` 흰색. 구역 구분은 `bg-soft`, 빈 상태 상자는 `bg-subtle` |
| 글자 | 본문 `text`, 설명 `text-sub`, 날짜·보조 `text-meta`, 비활성 `text-disabled` |
| 강조·주요 버튼 | `blue`. 링크·선택된 글자·작은 강조 글자는 `blue-deep` |
| 옅은 강조 바탕 | `blue-soft` (작은 버튼, 안내 배너, 선택 상태) |
| 상태 | 오류 `danger`/`danger-soft`, 성공 `green`/`green-soft`, 주의 `amber`/`amber-soft` |
| 연속일 불꽃 | `flame`/`flame-soft`. 아이콘과 채움에만, 글자는 `text` |
| 영상 위 | 글자 `on-accent`, 보조 글자 `on-media-sub`, 막 `scrim` |

- 강조색은 화면당 파랑 하나다. 다른 색은 상태를 알릴 때만 쓴다.
- `blue`(#4880EE)는 흰 바탕 대비가 3.75라 작은 글자에 쓰지 않는다. `icon-faint`는 글자에 쓰지 않는다.
- 보라·파랑 그라데이션, 무지개 강조, 네온 같은 장식색을 쓰지 않는다. 그라데이션은 영상 위 글자를 읽히게 하는 한 색 진하기 막(`band-gradient`)만 쓴다.

## 3. 글자

- 글꼴은 Pretendard 하나다.
- 크기는 위 `typography` 11단계만 쓴다. 화면 제목 `title1`/`title2`, 머리줄 제목 `headline`, 본문 `body1`, 목록·설명 `body2`, 날짜·메타 `caption`, 배지 `micro`.
- 위계는 크기와 굵기로 만들고 색은 `text` → `text-sub` → `text-meta` 세 단계까지만 연하게 한다.

## 4. 모양·간격·그림자

- 화면 좌우 여백 `gutter` 20. 간격은 4의 배수(`space`), 6은 아이콘과 글자 사이에만.
- 모서리: 입력칸·토스트 `md` 12, 카드 `lg` 16, 대화창·확인창 `xl` 24, 알약 `full`.
- 카드는 그림자 대신 1px `border` 테두리다. 그림자(`shadow-overlay`)는 메뉴, 토스트, 떠 있는 버튼, iOS 탭바에만 쓴다.

## 5. 부품

부품은 `components/ui/`에 있고 pen 부품 이름과 같다. 새 화면은 여기 있는 부품으로 먼저 만든다.

| 부품 | 모양 |
|---|---|
| Button (`buttons.tsx`) | primary·secondary·danger. 높이 lg 48(headline), md 40(body2-bold), sm 32(옅은 파랑 바탕). 누른 뒤 기다릴 때는 글자 자리에 짧은 문구(기본 「잠시만요…」) |
| BottomCTA (`cta-bar.tsx`) | 아래 고정 바. 흰 바탕, 위 구분선 없음, 안쪽 위 12·좌우 20·아래 안전영역+12 |
| NavHeader | 높이 44, 가운데 제목 headline, 양쪽 44 칸 |
| StepHeader | NavHeader 줄에 「n / N」과 아래 4px 진행 막대 |
| TextField | 이름표 body2-bold text-sub, 입력칸 높이 48·r-md·1px border |
| Chip | 높이 40 알약, 흰 바탕·1px border, body2-bold text-sub. 켜지면 파랑 |
| SelectCard | 둘 중 하나 고르기. 흰 바탕·1px border·r-lg·안쪽 20 |
| Settings card / ListRow | 흰 바탕·1px border·r-lg·안쪽 16, 왼쪽 아이콘 20 |
| Underline tabs | 같은 폭 칸, 높이 44, 고른 탭 text·나머지 text-meta, 아래 막대 |
| Switch | `BlueSwitch`만 쓴다. 켜짐 blue, 꺼짐 text-disabled |
| Checkbox | 원 22, 켜짐은 파랑 원 안 흰 체크 |
| Badge | 높이 20 알약, danger 바탕, micro 흰 글자 |
| Toast | 높이 48, `toast` 바탕, r-md, 아이콘 18 + body2-bold 흰 글자 |
| Dialog | 폭 320, r-xl, 안쪽 24, 가운데 정렬. 제목은 결과 문장 |
| Info banner | blue-soft 상자, 제목 body2-bold blue-deep, 설명 body2 text-sub |
| Notice band | 주의는 amber-soft, 숨김 같은 문제는 danger-soft, r-md |
| InlineEmpty | 목록이 비었을 때 bg-subtle 상자, 제목 body2-bold text-sub |
| InlineError | 일부를 못 불러왔을 때 danger-soft 상자와 다시 시도 |
| Skeleton | 화면을 열 때 실제 내용 모양의 회색 칸이 은은하게 깜빡임 |
| FloatingButton/Add | 목록의 추가 전용, 높이 48 알약, blue, shadow-overlay |
| DoneScreen | 완료 화면. 머리 없음, 액티 120이 폴짝 |

아이콘은 Feather 선 아이콘이다.

## 6. 화면 규칙

- **로딩**: 화면을 열 때는 뼈대 화면(Skeleton)이다. 빈 화면이나 빙글이를 쓰지 않는다. 버튼을 누르고 기다릴 때는 짧은 상태 문구를 보여 준다.
- **팝업**: 아래에서 올라오는 시트를 쓰지 않는다. 정말 중요한 확인만 가운데 확인창(Dialog)이고, 나머지는 화면 안에 넣거나 새 화면으로 연다.
- **하단 탭바**: iOS는 떠 있는 캡슐, Android는 바닥에 붙는다. 아이콘만 보이고 이름은 고른 탭에만 나온다.
- **빈 상태·오류**: 화면 전체를 막지 않고 그 자리에 InlineEmpty·InlineError를 둔다. 문구는 다음에 할 일을 알려 준다.
- **입력**: 쉬는 시간처럼 숫자를 정하는 조작은 미리 정한 버튼보다 숫자를 직접 넣는 쪽을 쓴다.
- **같은 화면은 같게**: 같은 화면이 여러 곳에 있으면 모양을 똑같이 맞춘다. 이미 승인된 디자인이 있으면 그것을 다시 쓴다.

## 7. 영상 위 화면

- 챌린지 재생처럼 영상이 화면을 채우는 곳은 글자를 흰색(`on-accent`, 보조 `on-media-sub`)으로 쓰고, 읽히지 않을 때만 한 색 진하기 막(`band-gradient`, `scrim`)을 깐다.
- 얼굴 가림을 켠 참여작은 공유·저장할 때도 가림을 유지하고 프로필 사진을 싣지 않는다.
- 인스타 공유 프레임(액터브에서 한 연기임을 드러내는 틀)은 시안 단계이고 방향을 고르지 않았다(2026-11-25 A 다크 카드 · B 슬레이트 · C 자막).

## 8. 문구

- 해요체, 짧은 완성 문장. 예: 「아직 기록이 없어요.」, 「잠시만요…」.
- 연습의 산출물은 「리포트」가 아니라 「연습 노트」다. 「AI 리포트」는 챌린지 참여작 설명에만 쓴다.
- 연습 화면에서 배우와 마주 앉은 상대는 「AI」가 아니라 「코치」다.
- 쓰지 않는 말: 「평가 받기」, 「점수 확인」, 「약점 보기」, 「정답 보기」, 「AI 피드백 받기」. 용어는 `docs/agents/domain.md`를 따른다.
- 제목은 결과를 말한다(확인창 제목 = 결과 문장).
- 공식 대사·챌린지 이름표는 「Acttub 공식 대사」, 「이번 주 대사 챌린지」.

## 9. 하지 않는 것

- 평가표처럼 보이는 화면: 점수 원형, 레이더 차트, 판정하는 코치 아바타, 좋음·나쁨을 암시하는 색 매핑(ADR-005).
- AI 템플릿 장식: 「Powered by AI」 배지, 보라·인디고 팔레트, 그라데이션 글자, 배경 그라데이션 원, 유리 효과 카드, 글로우 애니메이션, 반짝이 아이콘, 과한 폭죽·이모지.
- 상태 변화를 설명하지 않는 애니메이션. 예외는 연속 연습일이 늘어난 순간의 전체화면 축하(SOMA-494)이며, 여기에도 글로우·그라데이션 흐름은 쓰지 않는다.
- 같은 크기 둥근 상자 2~4개를 나란히 놓는 칸칸 배치, 칩·알약 나열. 묶음은 여백과 글자 크기로 나눈다.
- 의미 없는 일러스트, 기본 회색 테마.
- 카드 그림자(테두리로 대신), 하단 시트, 로딩 빙글이.
- 토큰 밖 색·글자 크기 숫자.
- 마스코트가 주인공인 랜딩·홍보 화면.
