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
import { currentFirstUseOwner, firstUseOwnerReady } from './practice/first-use-graduation';
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

/**
 * 화면 가이드는 계정별로 기억한다(10/25). 예전엔 기기 하나에 한 값이라 같은 폰에서 계정을 바꾸면 새 계정도 「봤음」이었다.
 * 계정을 모르면 예전처럼 기기 값을 쓴다. 예전 기기 값은 누구 것인지 몰라 이어받지 않는다 — 처음엔 이어받게 했더니
 * 업데이트 뒤 처음 들어온 새 계정이 앞 계정의 「봤음」을 가져가 첫 연습 안내를 못 봤다(폰 확인). 1.0.0 안내는 새 내용이라
 * 기존 사용자도 계정마다 한 번 보는 게 맞다.
 */
function ownedSpotlightKey(topic: SpotlightTopic, owner: string | null): string {
  return owner ? `${spotlightKey(topic)}.${owner}` : spotlightKey(topic);
}

/** 계정이 정해질 때까지 기다리는 한도. 로그인 전 화면에서는 안내를 띄우지 않는다. */
const OWNER_WAIT_MS = 4000;

/**
 * 계정을 끝내 모르면 본 것으로 친다 — 계정 없는 키를 읽으면 이미 본 사람도 「안 봤음」이 되어 켤 때마다 다시 떴다
 * (1.0.1 운영: 서버가 느려 me 가 4초 넘게 걸린 기기). 화면은 다음에 들어올 때 다시 묻는다.
 */
export async function hasSeenSpotlight(topic: SpotlightTopic, waitMs = OWNER_WAIT_MS): Promise<boolean> {
  const owner = await firstUseOwnerReady(waitMs);
  if (!owner) return true;
  return seen(ownedSpotlightKey(topic, owner));
}

export function markSpotlightSeen(topic: SpotlightTopic): Promise<void> {
  return mark(ownedSpotlightKey(topic, currentFirstUseOwner()));
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
      ...SPOTLIGHT_TOPICS.map((topic) => store.removeItem(ownedSpotlightKey(topic, currentFirstUseOwner()))),
      store.removeItem(TUTORIAL_KEY),
      store.removeItem(READING_TUTORIAL_KEY),
      store.removeItem(AUTO_ADVANCE_TIP_KEY),
    ]);
  } catch {
    // no-op
  }
}
