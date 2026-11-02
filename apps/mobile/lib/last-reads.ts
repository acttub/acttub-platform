/**
 * 화면끼리 같이 쓰는 「마지막으로 받은 답」 — 탭을 처음 열 때 서버 답을 기다리지 않게 한다.
 *
 * 홈은 앱을 켤 때 코칭 묶음·대본 목록·내 참여작을 이미 받는다. 예전에는 코칭·대본·커뮤니티·프로필 탭이 처음 열릴 때
 * 같은 것을 서버에 다시 묻고, 답이 올 때까지 뼈대만 보였다(11/2 사용자 지적 「처음 들어갈 때만 느리다」).
 * 이제 api 가 이 답들을 받을 때마다 여기에 남기고, 탭은 남은 답으로 바로 그린 뒤 들어올 때마다 새로 받아 칸만 바꾼다
 * (큰 앱들의 「받아 둔 것 먼저, 새 것은 뒤에서」 방식).
 *
 * 메모리에만 둔다 — 앱을 끄면 사라지고, 로그아웃·탈퇴 때 resetLastReads 로 비운다(다른 계정에 남지 않게).
 */
export type LastReadKey = 'practiceGroups' | 'readingScripts' | 'myChallengeEntries' | 'challengesPopular' | 'challengesEnded';

const reads = new Map<LastReadKey, unknown>();
/** 계정이 바뀐 뒤 늦게 도착한 옛 계정 답을 버리기 위한 세대 번호. */
let generation = 0;

export function lastRead<T>(key: LastReadKey): T | undefined {
  return reads.get(key) as T | undefined;
}

export function rememberRead<T>(key: LastReadKey, value: T): T {
  reads.set(key, value);
  return value;
}

/** 요청을 보낼 때의 세대. 답이 왔을 때 세대가 바뀌었으면(그 사이 로그아웃) 남기지 않는다. */
export function readGeneration(): number {
  return generation;
}

export function rememberReadIfCurrent<T>(key: LastReadKey, value: T, askedAt: number): T {
  if (askedAt === generation) reads.set(key, value);
  return value;
}

export function resetLastReads(): void {
  reads.clear();
  generation += 1;
}
