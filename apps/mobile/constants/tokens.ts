import type { TextStyle } from 'react-native';

/**
 * 글자·모서리·간격 토큰. 이름과 값은 디자인 시스템 pen 변수(`docs/DESIGN-SYSTEM.md` 「글자」·「모서리·간격·그림자」)와 같다.
 *
 * 화면에서 크기·모서리·간격 숫자를 직접 적지 않는다. 색은 `palette.ts`.
 */
export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  title1: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  title2: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 26, fontWeight: '600' },
  body1: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  body1Bold: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  body2: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  body2Bold: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  captionBold: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  micro: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
} satisfies Record<string, TextStyle>;

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

/** 6 은 아이콘–글자 사이에만. `gutter` 는 화면 좌우 여백. */
export const space = { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, gutter: 20 } as const;
