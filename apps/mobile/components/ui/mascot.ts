import type { ImageSourcePropType } from 'react-native';

/**
 * 액티(마스코트) 자세 — pen images/app 의 그림 그대로(SOMA-770). 화면마다 디자인이 쓰는 자세를 고른다.
 * - home: 두 팔 들고 웃는 액티 — 홈·온보딩 시작·첫 가이드 1·4·완료/마무리 화면
 * - coach: 물음표 갸웃 — 질문하는 화면(온보딩 질문·코칭 준비·상태/실패 화면·대화)
 * - reading: 대본 든 액티 — 리딩 화면 전부, 첫 가이드 2
 * - cheer: 손 흔드는 액티 — 노트 응원(디자인 프레임에는 없음, 1차부터 쓰던 것)
 */
export const MASCOT: Record<'home' | 'coach' | 'reading' | 'cheer', ImageSourcePropType> = {
  home: require('@/assets/images/mascot-home.png'),
  coach: require('@/assets/images/mascot-coach.png'),
  reading: require('@/assets/images/mascot-reading.png'),
  cheer: require('@/assets/images/mascot-cheer.png'),
};

/** pen 에서 쓰는 크기 — 그림 비율(약 9:10)을 지킨다. */
export const MASCOT_SIZE = {
  /** 대화 머리(36×40). */
  xs: { width: 36, height: 40 },
  /** 홈 카드(48×54). */
  card: { width: 48, height: 54 },
  /** 마스코트 줄·리딩/챌린지 마무리(52×58). */
  sm: { width: 52, height: 58 },
  /** 질문 말풍선 옆(52×61) — pen 「온보딩 / 질문 말풍선」. */
  bubble: { width: 52, height: 61 },
  /** 예전 말풍선 옆(70×78). */
  md: { width: 70, height: 78 },
  /** 상태 화면 가운데(84×94). */
  lg: { width: 84, height: 94 },
  /** 첫 가이드 말풍선(86×96). */
  guide: { width: 86, height: 96 },
  /** 가입할 수 없어요(120×132). */
  xl: { width: 120, height: 132 },
  /** 가입 시작·광고성 정보 결과 팝업 뒤(127×142). */
  intro: { width: 127, height: 142 },
  /** 온보딩 시작(150×168). */
  hero: { width: 150, height: 168 },
} as const;
