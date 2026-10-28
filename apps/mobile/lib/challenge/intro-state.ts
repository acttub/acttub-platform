/**
 * A14~A14.2 시작 안내 — 기기당 챌린지 탭에 처음 들어올 때 한 번만 보여 준다(challenge.browse).
 * 플래그는 기기 저장소다. 계정이 아니라 기기 기준이라 다시 로그인해도 다시 뜨지 않는다.
 */
const KEY = 'acttub.challenge.introSeen';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function hasSeenChallengeIntro(): Promise<boolean> {
  try {
    return (await storage().getItem(KEY)) === '1';
  } catch {
    // 못 읽으면 본 것으로 — 들어올 때마다 뜨는 쪽이 더 나쁘다.
    return true;
  }
}

export async function markChallengeIntroSeen(): Promise<void> {
  try {
    await storage().setItem(KEY, '1');
  } catch {
    // 못 적어도 흐름은 그대로 간다.
  }
}

/**
 * 파란 「누를 것 안내」는 첫 챌린지 참여를 끝낼 때까지만 보인다(SOMA-748 최종.pen 화면 메모).
 * 첫 참여작을 만들면 기기에 표시한다. 계정이 아니라 기기 기준이다.
 */
const FIRST_ENTRY_KEY = 'acttub.challenge.firstEntryDone';

export async function hasFinishedFirstChallenge(): Promise<boolean> {
  try {
    return (await storage().getItem(FIRST_ENTRY_KEY)) === '1';
  } catch {
    // 못 읽으면 안내를 보인다 — 안내가 한 번 더 보이는 쪽이 덜 나쁘다.
    return false;
  }
}

export async function markFirstChallengeFinished(): Promise<void> {
  try {
    await storage().setItem(FIRST_ENTRY_KEY, '1');
  } catch {
    // 못 적어도 흐름은 그대로 간다.
  }
}

/**
 * 첫 챌린지 화면(이번 주 대사 + 고르기)에서 「챌린지 둘러보기」를 고른 기기 — 그 뒤로는 기본 챌린지 홈을 보인다(SOMA-827).
 * 참여작을 올린 것(firstEntryDone)과 따로 둔다 — 둘러보기만 한 사람에게도 「누를 것 안내」는 첫 참여까지 남는다.
 */
const BROWSED_KEY = 'acttub.challenge.browsed';

export async function hasBrowsedChallenges(): Promise<boolean> {
  try {
    return (await storage().getItem(BROWSED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markChallengesBrowsed(): Promise<void> {
  try {
    await storage().setItem(BROWSED_KEY, '1');
  } catch {
    // 못 적어도 이번에는 기본 홈으로 간다.
  }
}
