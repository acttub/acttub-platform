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

export const CHALLENGE_INTRO_KEY = KEY;
