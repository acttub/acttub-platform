/**
 * 앱 평가 요청 (SOMA-494) — 순수 판정. RN 모듈에 기대지 않아 node 테스트로 잠근다.
 *
 * AI 코칭을 2번 마칠 때마다, 대본을 2번 완주할 때마다(SOMA-661 — 1번마다는 잦았다) "별점과 리뷰를 남겨 주세요"를 묻는다. 다만
 * 스토어는 사용자가 실제로 평가했는지 앱에 알려 주지 않으므로 우리 시트에서 "남기기"를 누른 것으로만
 * 그친 것으로 본다. 조르지 않도록 최소 7일 간격·최대 3번(iOS 인앱 평점 창의 1년 한도와 같다)만 묻는다.
 */

import { DEFAULT_APP_CONFIG, getAppConfig } from './app-config.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// 아래 상수는 기본값이다. 판정은 쓰는 순간 서버 설정(getAppConfig().rating)을 읽는다(SOMA-939).
export const RATING_COACH_EVERY = DEFAULT_APP_CONFIG.rating.coachEvery;
export const RATING_READING_EVERY = DEFAULT_APP_CONFIG.rating.readingEvery;
export const RATING_MIN_GAP_MS = DEFAULT_APP_CONFIG.rating.minGapDays * DAY_MS;
export const RATING_MAX_ASKS = DEFAULT_APP_CONFIG.rating.maxAsks;
/** 같은 연습을 두 번 세지 않으려고 기억하는 최근 연습 id 수 */
const REMEMBERED_PRACTICES = 20;

export type RatingState = {
  /** 우리 시트에서 "남기기"를 눌렀다 — 다시 묻지 않는다 */
  rated: boolean;
  /** 지금까지 물은 횟수 */
  asks: number;
  /** 마지막으로 물은 시각(ms) */
  lastAskAt: number | null;
  /** 마지막으로 물은 뒤 마친 AI 코칭 수 */
  coachSinceAsk: number;
  /** 마지막으로 물은 뒤 완주한 대본 리딩 수 */
  readingSinceAsk: number;
  /** 이미 센 연습 id */
  counted: string[];
};

export const EMPTY_RATING_STATE: RatingState = {
  rated: false,
  asks: 0,
  lastAskAt: null,
  coachSinceAsk: 0,
  readingSinceAsk: 0,
  counted: [],
};

export type RatingEvent = { kind: 'coach'; practiceId: string } | { kind: 'reading' };

function mayAsk(state: RatingState, now: number): boolean {
  const { maxAsks, minGapDays } = getAppConfig().rating;
  if (state.rated || state.asks >= maxAsks) return false;
  return state.lastAskAt === null || now - state.lastAskAt >= minGapDays * DAY_MS;
}

/** 사건을 세고 지금 물어야 하는지 답한다. 묻기로 했으면 보여 준 뒤 {@link afterAsk} 로 남긴다. */
export function recordEvent(state: RatingState, event: RatingEvent, now: number): { state: RatingState; ask: boolean } {
  if (event.kind === 'reading') {
    const next: RatingState = { ...state, readingSinceAsk: state.readingSinceAsk + 1 };
    return { state: next, ask: next.readingSinceAsk >= getAppConfig().rating.readingEvery && mayAsk(next, now) };
  }
  if (state.counted.includes(event.practiceId)) return { state, ask: false };
  const next: RatingState = {
    ...state,
    coachSinceAsk: state.coachSinceAsk + 1,
    counted: [...state.counted, event.practiceId].slice(-REMEMBERED_PRACTICES),
  };
  return { state: next, ask: next.coachSinceAsk >= getAppConfig().rating.coachEvery && mayAsk(next, now) };
}

/** 시트를 보여 준 뒤 — "나중에"를 눌러도 이 간격은 지킨다. */
export function afterAsk(state: RatingState, now: number): RatingState {
  return { ...state, asks: state.asks + 1, lastAskAt: now, coachSinceAsk: 0, readingSinceAsk: 0 };
}

/** "남기기"를 눌렀다. */
export function afterRated(state: RatingState): RatingState {
  return { ...state, rated: true };
}

/** 저장된 값이 깨졌거나 모양이 다르면 처음 상태로 — 조르는 쪽보다 한 번 더 묻는 쪽이 낫다. */
export function parseRatingState(raw: string | null): RatingState {
  if (!raw) return EMPTY_RATING_STATE;
  try {
    const value = JSON.parse(raw) as Partial<RatingState>;
    return {
      rated: value.rated === true,
      asks: typeof value.asks === 'number' ? value.asks : 0,
      lastAskAt: typeof value.lastAskAt === 'number' ? value.lastAskAt : null,
      coachSinceAsk: typeof value.coachSinceAsk === 'number' ? value.coachSinceAsk : 0,
      readingSinceAsk: typeof value.readingSinceAsk === 'number' ? value.readingSinceAsk : 0,
      counted: Array.isArray(value.counted) ? value.counted.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return EMPTY_RATING_STATE;
  }
}

/** 스토어의 리뷰 쓰기 화면 주소 — 설정의 "앱 평가하기"와, 인앱 평점 창이 안 뜰 때 쓴다. */
export function storeReviewUrl(platform: string): string {
  return platform === 'ios'
    ? 'itms-apps://apps.apple.com/app/id6793056855?action=write-review'
    : 'https://play.google.com/store/apps/details?id=com.acttub.app&showAllReviews=true';
}
