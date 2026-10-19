import type { ChallengeCard } from '@/lib/challenge/types';

/** 이미 끝난 날짜. dDayLabel 이 지금 시각과 상관없이 '종료'를 낸다. */
export const ENDED_AT = '2020-01-08T00:00:00Z';
/** 먼 미래. 진행 중인 챌린지로 보인다. */
export const RUNNING_ENDS_AT = '2099-01-01T00:00:00Z';

export function challengeCard(overrides: Partial<ChallengeCard> = {}): ChallengeCard {
  return {
    id: 'c1',
    line: '나는 아직 끝나지 않았어',
    work: '햄릿',
    character: '햄릿',
    scene_note: null,
    origin: 'team',
    host_name: null,
    starts_at: '2020-01-01T00:00:00Z',
    ends_at: ENDED_AT,
    featured_on: null,
    moderation: 'visible',
    entry_count: 3,
    like_sum: 10,
    participants: [],
    more_count: 0,
    ...overrides,
  };
}
