/**
 * 앱 색 토큰 24개. 이름과 값은 디자인 시스템 pen 변수(`docs/DESIGN-SYSTEM.md` 「색」)와 같다.
 *
 * 화면에서 색을 직접 적지 않는다. pen 값이 바뀌면 여기만 고친다.
 */
export const palette = {
  bg: '#FFFFFF',
  bgSoft: '#F2F4F6',
  bgSubtle: '#F9FAFB',
  border: '#E5E8EB',

  text: '#191F28',
  textSub: '#4E5968',
  textMeta: '#6B7684',
  textDisabled: '#B0B8C1',
  // 글자에 쓰지 않는다(흰 바탕 대비 4.5 미만).
  iconFaint: '#8B95A1',

  // 작은 글자에 쓰지 않는다(흰 바탕 대비 3.75). 링크·선택 글자는 blueDeep.
  blue: '#4880EE',
  blueDeep: '#3268D8',
  blueSoft: '#EAF3FE',

  danger: '#E42939',
  dangerSoft: '#FFF0F0',
  green: '#009959',
  greenSoft: '#E5F8EF',
  amber: '#8A4B00',
  amberSoft: '#FFF8EC',
  // 연속일 불꽃 아이콘·채움에만 쓴다. 글자는 text.
  flame: '#FF6B2C',
  flameSoft: '#FFF1E8',

  onAccent: '#FFFFFF',
  onMediaSub: '#FFFFFFB3',
  scrim: '#0F141E73',
  toast: '#191F28E6',
};
