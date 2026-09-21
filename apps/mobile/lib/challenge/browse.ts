import { translate } from '../i18n.ts';
import { SEARCH_MIN_LENGTH, type ChallengeCard, type ChallengeDetail, type ChallengeTab, type EntryCard, type EntrySort, type Participant } from './types.ts';

/**
 * 대사 목록·상세·랭킹의 표시 규칙(challenge.browse).
 *
 * 좋아요 랭킹은 사람들의 반응 수를 세운 순서다(ADR-005 개정의 명시적 예외) — 연기를 채점하는
 * 것이 아니다. 좋아요가 같으면 공동 순위이고 같은 순위 안에서는 최초 공개 시각·id 순이다.
 * 최신순에는 순위 숫자가 없고 가장 최근 하나에만 NEW 가 붙는다. 좋아요가 모두 0이면 1위 배지가
 * 없다. 종료된 챌린지는 굳은 값을 보여 주고, 확정 전에는 "집계 중"이다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 오늘의 챌린지는 인기·최신 탭 맨 위에만 고정한다(종료·내 챌린지에는 없다). */
export function pinsFeatured(tab: ChallengeTab): boolean {
  return tab === 'popular' || tab === 'latest';
}

/** 검색은 2자 이상일 때만 찾는다. */
export function searchable(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH;
}

/** 참여자 아바타는 이름 첫 글자다(사진은 보이지 않는다). */
export function avatarLetter(name: string): string {
  return [...name.trim()][0] ?? '?';
}

/** "윤서 · 태오 · 민재 +12" 처럼 셋과 나머지 수. */
export function participantsLabel(participants: readonly Participant[], moreCount: number): string {
  const names = participants.slice(0, 3).map((p) => p.name.trim()).filter(Boolean);
  if (names.length === 0) return translate('challenges.noParticipants');
  const joined = names.join(' · ');
  return moreCount > 0 ? `${joined} +${moreCount}` : joined;
}

export function isEnded(challenge: Pick<ChallengeCard, 'ends_at'>, now: number = Date.now()): boolean {
  const ends = Date.parse(challenge.ends_at);
  return Number.isNaN(ends) ? false : ends <= now;
}

/** 진행 중이면 "D-N", 끝났으면 종료다. 마감 당일은 D-0 이 아니라 D-1 로 센다(남은 날). */
export function dDayLabel(challenge: Pick<ChallengeCard, 'ends_at'>, now: number = Date.now()): string {
  if (isEnded(challenge, now)) return translate('challenges.ended');
  const ends = Date.parse(challenge.ends_at);
  const days = Math.max(1, Math.ceil((ends - now) / DAY_MS));
  return translate('challenges.dday', { days });
}

/** 주최자 줄 — 기획팀 챌린지는 주최자가 없고, 탈퇴한 주최자는 그렇게 보인다. */
export function hostLabel(challenge: Pick<ChallengeCard, 'origin' | 'host_name'>): string {
  if (challenge.origin === 'team') return translate('challenges.hostTeam');
  const name = challenge.host_name?.trim();
  return name ? translate('challenges.hostMember', { name }) : translate('challenges.hostWithdrawn');
}

/** 운영 검토·숨김 챌린지를 주최자 본인이 열었을 때의 안내. 아니면 없다. */
export function moderationNotice(challenge: Pick<ChallengeCard, 'moderation'>): string | null {
  if (challenge.moderation === 'review') return translate('challenges.underReview');
  if (challenge.moderation === 'hidden') return translate('challenges.hiddenByOps');
  return null;
}

export type RankedEntry = EntryCard & {
  /** 좋아요순에서의 공동 순위. 최신순에는 없다. */
  displayRank: number | null;
  /** 1위 배지를 보일지 — 좋아요가 모두 0이면 아무도 보이지 않는다. */
  showsFirstBadge: boolean;
  /** 최신순에서 가장 최근 하나에만 붙는다. */
  isNew: boolean;
};

function comparePublished(a: EntryCard, b: EntryCard): number {
  const at = Date.parse(a.published_at) - Date.parse(b.published_at);
  return at !== 0 ? at : a.id.localeCompare(b.id);
}

/**
 * 화면에 그릴 순서와 배지를 붙인다. 서버가 순위를 주면 그것을 쓰고, 없으면 같은 규칙으로 센다
 * (좋아요 내림차순, 같으면 최초 공개 시각·id 순, 같은 좋아요는 같은 순위).
 */
export function rankEntries(entries: readonly EntryCard[], sort: EntrySort): RankedEntry[] {
  if (sort === 'latest') {
    const sorted = [...entries].sort((a, b) => -comparePublished(a, b));
    return sorted.map((entry, index) => ({
      ...entry,
      displayRank: null,
      showsFirstBadge: false,
      isNew: index === 0,
    }));
  }
  const sorted = [...entries].sort((a, b) => b.like_count - a.like_count || comparePublished(a, b));
  const anyLikes = sorted.some((entry) => entry.like_count > 0);
  let lastLikes: number | null = null;
  let lastRank = 0;
  return sorted.map((entry, index) => {
    const rank =
      entry.rank ?? (entry.like_count === lastLikes ? lastRank : index + 1);
    lastLikes = entry.like_count;
    lastRank = rank;
    return {
      ...entry,
      displayRank: rank,
      // 좋아요가 모두 0이면 1위 배지를 보이지 않는다.
      showsFirstBadge: anyLikes && rank === 1 && entry.like_count > 0,
      isNew: false,
    };
  });
}

/** 1위 카드의 배지 문구. 종료 뒤에는 굳은 값이다. */
export function firstBadgeLabel(entry: Pick<EntryCard, 'like_count'>, ended: boolean): string {
  return ended
    ? translate('challenges.finalFirst', { count: entry.like_count })
    : translate('challenges.currentFirst', { count: entry.like_count });
}

/** 종료됐지만 순위가 아직 굳지 않았으면 "집계 중"이다. */
export function rankingNotice(
  challenge: Pick<ChallengeDetail, 'ends_at' | 'ranking_state'>,
  now: number = Date.now(),
): string | null {
  if (!isEnded(challenge, now)) return null;
  return challenge.ranking_state === 'final' ? translate('challenges.finalRanking') : translate('challenges.counting');
}

/** 순위를 감추어야 하는지 — 종료됐는데 아직 확정 전이면 숫자·배지를 보이지 않는다. */
export function ranksHidden(
  challenge: Pick<ChallengeDetail, 'ends_at' | 'ranking_state'>,
  now: number = Date.now(),
): boolean {
  return isEnded(challenge, now) && challenge.ranking_state !== 'final';
}

/**
 * 주최자가 지울 수 있는지 — 참여작이 한 번도 생기지 않은 자기 챌린지만 지운다. 참여작이 생기면
 * 지울 수 없고 운영 숨김만 있다(422 challenge_has_entries).
 */
export function canDelete(challenge: Pick<ChallengeCard, 'is_host' | 'entry_count'>): boolean {
  return Boolean(challenge.is_host) && challenge.entry_count === 0;
}

export type BrowseFailure = { kind: 'member_only' } | { kind: 'cursor_expired' } | { kind: 'not_found' } | { kind: 'offline' } | { kind: 'other' };

export function browseFailure(error: unknown): BrowseFailure {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : null;
  const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : null;
  if (code === 'member_only' || status === 403) return { kind: 'member_only' };
  if (code === 'cursor_expired' || status === 410) return { kind: 'cursor_expired' };
  if (status === 404) return { kind: 'not_found' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || typeof status !== 'number' || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function browseFailureMessage(failure: BrowseFailure): string {
  switch (failure.kind) {
    case 'member_only':
      return translate('challenges.memberOnly');
    case 'cursor_expired':
      return translate('challenges.cursorExpired');
    case 'not_found':
      return translate('challenges.notFound');
    case 'offline':
      return translate('challenges.offline');
    default:
      return translate('challenges.loadFail');
  }
}
