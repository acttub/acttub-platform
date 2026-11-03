/**
 * 홈이 다 그려지면 곧바로, 다른 탭이 처음 열릴 때 받을 것을 한꺼번에 미리 받아 둔다(SOMA-1028).
 *
 * 전에는 탭을 누르고 나서야 받았다. 탭 미리 만들기(lib/tab-warmup)도 커뮤니티 목록 하나만 받아 두었다.
 * 이제 홈이 뜨는 즉시 — 탭을 만들기 시작하는 시간(WARM_START_DELAY_MS)을 기다리지 않고 — 아래를 병렬로 받아
 * lib/last-reads 에 남긴다. 탭은 마운트할 때 남은 답으로 바로 그리고, 들어올 때마다 새로 받아 칸만 바꾼다.
 *
 * - 커뮤니티: 인기·끝난 목록(탭이 처음 그리는 두 가지)
 * - 리딩: 「이전에 하던 대본부터」 카드(목록 → 이어 읽을 대본의 회차)
 * - 프로필: 「이번 달 연습」 숫자(묶음·참여작 전체·이번 달 연습한 대본의 회차)
 * - 코칭: 홈이 이미 받은 묶음을 그대로 쓰므로 더 받을 것이 없다
 *
 * 홈이 이미 받은 묶음·대본 목록·참여작 첫 장은 다시 묻지 않는다. 계정이 바뀌면(로그아웃) 늦게 온 답은 남지 않는다.
 * 서버가 5개씩만 받는 안드로이드 줄을 고려해 호출 수는 적게 둔다: 평소 커뮤니티 2 + 회차 1~4개.
 */
import { lastRead, readGeneration, rememberReadIfCurrent } from './last-reads.ts';
import { inMonth, monthPracticeCounts } from './profile-month-stats.ts';
import type { ScriptCard } from './reading/types.ts';
import { resumeCandidate, resumeSessionOf } from './reading/redesign-748.ts';

type Script = Pick<ScriptCard, 'id' | 'status' | 'last_practiced_at'>;
type EntriesPage = { entries: unknown[]; next_cursor?: string | null };

export type PrefetchApi = {
  listChallenges: (params: { tab: 'popular' | 'ended' }) => Promise<unknown>;
  listPracticeGroups: (scope: 'all') => Promise<{ groups: unknown[] }>;
  listReadingScripts: () => Promise<{ scripts: Script[] }>;
  listReadingSessions: (scriptId: string) => Promise<{ sessions: any[] }>;
  listMyChallengeEntries: (kind?: undefined, cursor?: string) => Promise<EntriesPage>;
};

/** 커뮤니티 첫 화면의 인기 목록과 지난주 결과 띠. 받은 답은 api 가 lib/last-reads 에 남긴다. */
export function prefetchCommunity(api: PrefetchApi): Promise<unknown> {
  return Promise.allSettled([api.listChallenges({ tab: 'popular' }), api.listChallenges({ tab: 'ended' })]);
}

/** 홈이 받아 둔 답이 있으면 그것을, 없으면(홈 호출이 실패했거나 아직) 새로 받는다. */
async function sharedScripts(api: PrefetchApi): Promise<Script[]> {
  return lastRead<{ scripts: Script[] }>('readingScripts')?.scripts ?? (await api.listReadingScripts()).scripts;
}

/** 리딩 탭의 이어 읽기 카드. 이어 읽을 대본이 없으면 「없음」으로 남긴다(탭이 빈 카드를 먼저 그리지 않게). */
export async function prefetchReadingResume(api: PrefetchApi): Promise<void> {
  const askedAt = readGeneration();
  const scripts = await sharedScripts(api);
  const candidate = resumeCandidate(scripts);
  if (!candidate) {
    rememberReadIfCurrent('readingResume', null, askedAt);
    return;
  }
  const { sessions } = await api.listReadingSessions(candidate.id);
  const session = resumeSessionOf(sessions);
  rememberReadIfCurrent('readingResume', session ? { script: candidate, session } : null, askedAt);
}

/** 프로필 「이번 달 연습」 숫자 — 프로필 탭이 세는 것과 같은 재료로 센다. */
export async function prefetchProfileCounts(api: PrefetchApi, now: Date = new Date()): Promise<void> {
  const askedAt = readGeneration();
  const [groups, entries, readingSessions] = await Promise.all([
    lastRead<{ groups: unknown[] }>('practiceGroups')?.groups ?? api.listPracticeGroups('all').then((r) => r.groups),
    (async () => {
      // 홈이 받은 참여작 첫 장에서 이어 받는다. 20개씩이라 대부분 한 장이면 끝난다.
      const first = lastRead<EntriesPage>('myChallengeEntries') ?? (await api.listMyChallengeEntries());
      const all = [...first.entries];
      let cursor = first.next_cursor ?? undefined;
      while (cursor) {
        const page = await api.listMyChallengeEntries(undefined, cursor);
        all.push(...page.entries);
        cursor = page.next_cursor ?? undefined;
      }
      return all;
    })(),
    sharedScripts(api).then((scripts) =>
      Promise.all(scripts.filter((s) => inMonth(s.last_practiced_at, now)).map((s) => api.listReadingSessions(s.id).then((x) => x.sessions))),
    ).then((lists) => lists.flat()),
  ]);
  rememberReadIfCurrent('profileMonthCounts', monthPracticeCounts({ groups, readingSessions, entries } as never, now), askedAt);
}

/**
 * 커뮤니티 말고 나머지 탭 몫을 병렬로 시작한다. 하나가 실패해도 다른 것에 영향이 없고, 실패한 탭은 열 때 받는다.
 * 돌려주는 약속은 전부 끝나면(실패 포함) 풀린다.
 */
export function prefetchOtherTabs(api: PrefetchApi, now: Date = new Date()): Promise<unknown> {
  return Promise.allSettled([prefetchReadingResume(api), prefetchProfileCounts(api, now)]);
}
