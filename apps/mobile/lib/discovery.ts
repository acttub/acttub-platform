/**
 * 가입 직후 "액터브를 처음 어디서 알게 됐어요?"(SOMA-649)의 순수 로직. 가입 게이트(A0.2) 맨 아래의 선택 항목이고,
 * 프로필 저장이 끝난 뒤 PUT /v2/me/discovery 로 한 번 보낸다. 고르지 않고 저장하면 건너뜀(source=null)으로 적는다.
 *
 * Airbridge 설치 귀속은 iOS 추적 거부·스토어 직접 검색·지인 추천을 잡지 못한다. 그 빈칸을 배우가 기억하는 첫 경로로
 * 가늠한다 — 귀속과 같은 뜻이 아니다. 값 이름은 서버 허용값과 같다. 화면 문구는 locales 의 profileName 에 있다.
 */
export const DISCOVERY_SOURCES = [
  'instagram',
  'naver_search',
  'google_youtube',
  'app_store_search',
  'friend',
  'academy_school',
  'community',
  'other',
] as const;
export const INSTAGRAM_DETAILS = ['ad', 'official_post', 'other_post', 'unknown'] as const;
export const DISCOVERY_OTHER_MAX_LENGTH = 30;

export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];
export type InstagramDetail = (typeof INSTAGRAM_DETAILS)[number];

export type DiscoveryState = {
  source: DiscoverySource | null;
  detail: InstagramDetail | null;
  otherText: string;
};

export type DiscoveryPayload = {
  source: DiscoverySource | null;
  detail: InstagramDetail | null;
  other_text: string | null;
};

export const EMPTY_DISCOVERY: DiscoveryState = { source: null, detail: null, otherText: '' };

/**
 * 선택지 순서. 위에 있는 것을 더 고르는 쏠림을 사람마다 고르게 흩으려고 섞는다. '기타'는 늘 맨 아래다.
 * random 은 테스트가 주입한다.
 */
export function discoveryOrder(random: () => number = Math.random): DiscoverySource[] {
  const shuffled: DiscoverySource[] = DISCOVERY_SOURCES.filter((source) => source !== 'other');
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [...shuffled, 'other'];
}

/** 같은 것을 다시 누르면 고른 것을 푼다. 다른 것을 고르면 세부·직접 입력을 비운다. */
export function chooseDiscoverySource(state: DiscoveryState, source: DiscoverySource): DiscoveryState {
  if (state.source === source) return EMPTY_DISCOVERY;
  return { source, detail: null, otherText: '' };
}

/** 인스타그램 세부. 같은 것을 다시 누르면 푼다. */
export function chooseInstagramDetail(state: DiscoveryState, detail: InstagramDetail): DiscoveryState {
  if (state.source !== 'instagram') return state;
  return { ...state, detail: state.detail === detail ? null : detail };
}

/** 직접 입력은 30자(코드 포인트)까지만 받는다. */
export function limitOtherText(text: string): string {
  return [...text].slice(0, DISCOVERY_OTHER_MAX_LENGTH).join('');
}

/** 서버로 보낼 본문. 세부는 인스타그램일 때만, 직접 입력은 기타일 때만 싣고 빈 값은 null 이다. */
export function buildDiscoveryPayload(state: DiscoveryState): DiscoveryPayload {
  if (state.source === null) return { source: null, detail: null, other_text: null };
  const otherText = state.source === 'other' ? limitOtherText(state.otherText.trim()) : '';
  return {
    source: state.source,
    detail: state.source === 'instagram' ? state.detail : null,
    other_text: otherText.length > 0 ? otherText : null,
  };
}
