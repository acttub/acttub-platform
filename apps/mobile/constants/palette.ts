/**
 * acttub 디자인 토큰 — 목업(`목업-2026-08-03.pen`)의 `web-*` 변수를 옮긴 것.
 *
 * 앱이 예전에 쓰던 네이비 계열 토큰을 목업 값으로 갈아끼웠다. 키 이름은 그대로
 * 두었으므로 쓰는 쪽(23개 파일)은 고칠 것 없이 색만 함께 움직인다.
 *
 * 화면에서 색을 직접 적지 않는다 — 목업 값이 바뀌면 여기만 고치면 되게.
 */
export const palette = {
  // 바탕
  bg: '#FFFFFF',
  bgSoft: '#F2F4F6', // web-gray-bg
  bgSubtle: '#F9FAFB', // web-gray-bg-2
  card: '#FFFFFF',
  border: '#E5E8EB', // web-line
  borderSoft: '#EDF0F3', // web-line-soft
  borderStrong: '#CBD1D8', // pen borderStrong — 묶음 설정 카드 테두리

  // 글자 — 진한 순서
  text: '#191F28', // web-ink
  textStrong: '#333D4B', // web-ink-strong
  textDim: '#4E5968', // web-ink-sub
  textMuted: '#6B7684', // web-ink-3
  textFaint: '#8B95A1', // web-ink-4
  checkOff: '#B0B8C1', // web-ink-5

  // 파랑
  blue: '#4880EE', // pen 파이프라인 반영버전 Primary(옛 web-blue #3182F6)
  blueDeep: '#3268D8', // 말풍선 안내·고른 글자(옛 #1B64DA)
  blueSoft: '#EAF3FE', // 전체 동의·설정 아이콘 원(옛 #E8F3FF)
  blueMist: '#F8FBFF', // web-blue-mist
  blueLine: '#DCE9FF', // web-blue-line

  // 상태
  green: '#009959',
  greenSoft: '#E5F8EF',
  amber: '#8A4B00',
  flame: '#FF6B2C', // 연속일 불꽃 (SOMA-479)
  flameDeep: '#E8590C',
  coachName: '#D9622B', // 대화 「ACTTUB 코치」 이름(pen 09)
  flameSoft: '#FFF1E8',
  amberSoft: '#FFF8EC',
  hintIcon: '#F5A524', // 코치 힌트 전구 — 마스코트 주황
  danger: '#E42939',
  dangerSoft: '#FFF0F0',
  onAccent: '#FFFFFF',
  scrim: '#0F141E73',

  // 예전 토큰 — 아직 참조하는 화면이 있어 남긴다. 새 화면에서는 쓰지 않는다.
  navy: '#191F28',
};
