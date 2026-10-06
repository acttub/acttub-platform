/**
 * 가이드를 봤는지 기기에 기록한다.
 *
 * <p>{@link hasSeenSpotlight} — 화면에서 누를 자리를 비춰 주는 가이드(SOMA-550). 홈·대본
 * <b>화면마다 따로</b> 기억한다. 홈을 봤다고 대본 가이드가 사라지면 안 된다. 설정의 "가이드
 * 다시 보기"로 여는 슬라이드 넉 장은 기록하지 않는다 — 첫 실행에 띄우지 않고 설정에서만 연다.
 *
 * <p>못 읽으면 본 것으로 친다 — 매번 다시 뜨는 쪽이 한 번 못 보는 쪽보다 나쁘다.
 */

import { spotlightKey, type SpotlightTopic } from './guide-spotlight';
import { AUTO_ADVANCE_TIP_KEY } from './reading/guide-flag';

/** 연습 루프를 한 바퀴 돌아보는 튜토리얼(SOMA-494). 끝내거나 "나중에"를 누르면 기록한다. */
const TUTORIAL_KEY = 'acttub.tutorial.seen';
/** 대본 리딩 한 바퀴 튜토리얼(SOMA-494). AI 연습 튜토리얼과 따로 센다. */
const READING_TUTORIAL_KEY = 'acttub.tutorial.reading.seen';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** 스포트라이트를 띄우는 화면들. "다시 보기"가 이만큼을 되돌린다. */
const SPOTLIGHT_TOPICS: SpotlightTopic[] = ['home', 'reading', 'group'];

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

async function seen(key: string): Promise<boolean> {
  try {
    return (await storage().getItem(key)) === '1';
  } catch {
    return true; // 못 읽으면 본 것으로 — 매번 뜨는 쪽이 더 나쁘다
  }
}

async function mark(key: string): Promise<void> {
  try {
    await storage().setItem(key, '1');
  } catch {
    // no-op
  }
}

export function hasSeenSpotlight(topic: SpotlightTopic): Promise<boolean> {
  return seen(spotlightKey(topic));
}

export function markSpotlightSeen(topic: SpotlightTopic): Promise<void> {
  return mark(spotlightKey(topic));
}

export function hasSeenTutorial(): Promise<boolean> {
  return seen(TUTORIAL_KEY);
}

export function markTutorialSeen(): Promise<void> {
  return mark(TUTORIAL_KEY);
}

export function hasSeenReadingTutorial(): Promise<boolean> {
  return seen(READING_TUTORIAL_KEY);
}

export function markReadingTutorialSeen(): Promise<void> {
  return mark(READING_TUTORIAL_KEY);
}

/**
 * 설정의 "가이드 다시 보기"가 부른다. 슬라이드만 다시 열고 마는 게 아니라, 화면에서 누를
 * 자리를 비춰 주던 안내와 연습 한 바퀴 튜토리얼, 리딩의 자동 넘김 안내 팝업(「다시 보지 않기」)도
 * 되살린다 — "다시 보기"는 처음 안내를 다 다시 본다는 뜻이다.
 */
export async function resetSpotlights(): Promise<void> {
  try {
    const store = storage();
    await Promise.all([
      ...SPOTLIGHT_TOPICS.map((topic) => store.removeItem(spotlightKey(topic))),
      store.removeItem(TUTORIAL_KEY),
      store.removeItem(READING_TUTORIAL_KEY),
      store.removeItem(AUTO_ADVANCE_TIP_KEY),
    ]);
  } catch {
    // no-op
  }
}
