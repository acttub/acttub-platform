/**
 * 가입 직후 "액터브를 처음 어디서 알게 됐어요?"(SOMA-649)의 순수 로직. 가입 게이트(A0.2) 맨 아래의 선택 항목이고,
 * 프로필 저장이 끝난 뒤 PUT /v2/me/discovery 로 한 번 보낸다. 고르지 않고 저장하면 건너뜀(source=null)으로 적는다.
 *
 * Airbridge 설치 귀속은 iOS 추적 거부·스토어 직접 검색·지인 추천을 잡지 못한다. 그 빈칸을 배우가 기억하는 첫 경로로
 * 가늠한다 — 귀속과 같은 뜻이 아니다. 값 이름은 서버 허용값과 같다. 화면 문구는 locales 의 profileName 에 있다.
 *
 * SOMA-733: 선택지를 여섯 개 한 번으로 줄였다. 인스타그램 세부(광고·게시물)는 더 묻지 않고, 서버가 아직 받는
 * academy_school·community 는 화면에서 뺐다. google_youtube 는 값 이름만 그대로 두고 화면에는 '구글'로 보인다.
 * Airbridge 가 이미 출처를 확인한 설치는 묻지 않는다(shouldAskDiscovery).
 */
export const DISCOVERY_SOURCES = [
  'instagram',
  'app_store_search',
  'naver_search',
  'google_youtube',
  'friend',
  'other',
] as const;
export const DISCOVERY_OTHER_MAX_LENGTH = 30;

export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export type DiscoveryState = {
  source: DiscoverySource | null;
  otherText: string;
};

export type DiscoveryPayload = {
  source: DiscoverySource | null;
  detail: null;
  other_text: string | null;
};

export const EMPTY_DISCOVERY: DiscoveryState = { source: null, otherText: '' };

/** Airbridge 가 출처를 못 가린 채널. 이 둘이면 출처를 모르는 것으로 보고 묻는다. */
const UNKNOWN_CHANNELS = new Set(['unattributed', 'restricted']);

/**
 * 묻느냐. 기기에 저장된 Airbridge 귀속 채널이 광고·추적 링크처럼 이미 확인된 출처면 묻지 않는다.
 * 귀속이 아직 안 왔거나(null) 출처를 모르는 채널이면 묻는다.
 */
export function shouldAskDiscovery(attributedChannel: string | null | undefined): boolean {
  const channel = attributedChannel?.trim();
  if (!channel) return true;
  return UNKNOWN_CHANNELS.has(channel.toLowerCase());
}

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

/** 같은 것을 다시 누르면 고른 것을 푼다. 다른 것을 고르면 직접 입력을 비운다. */
export function chooseDiscoverySource(state: DiscoveryState, source: DiscoverySource): DiscoveryState {
  if (state.source === source) return EMPTY_DISCOVERY;
  return { source, otherText: '' };
}

/** 직접 입력은 30자(코드 포인트)까지만 받는다. */
export function limitOtherText(text: string): string {
  return [...text].slice(0, DISCOVERY_OTHER_MAX_LENGTH).join('');
}

/** 서버로 보낼 본문. 세부는 더 묻지 않아 늘 null 이고, 직접 입력은 기타일 때만 싣고 빈 값은 null 이다. */
export function buildDiscoveryPayload(state: DiscoveryState): DiscoveryPayload {
  if (state.source === null) return { source: null, detail: null, other_text: null };
  const otherText = state.source === 'other' ? limitOtherText(state.otherText.trim()) : '';
  return {
    source: state.source,
    detail: null,
    other_text: otherText.length > 0 ? otherText : null,
  };
}
