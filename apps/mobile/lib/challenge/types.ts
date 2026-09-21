/**
 * 챌린지 계약 타입(04-challenge). 챌린지는 대사 한 줄과 기간이고, 영상은 연습과 같은 videos 를 쓴다.
 *
 * 서버(CA1~)가 아직 없어 요구사항과 스펙의 API 표를 기준으로 둔다. 통합(CI1)이 생성 타입으로 바꾼다.
 * 챌린지에는 다른 사람의 **현재 프로필 이름만** 보인다 — 사진·소개는 없고 아바타는 이름 첫 글자다.
 */

/** 대사 목록의 탭. 오늘의 챌린지는 인기·최신에만 고정한다. */
export type ChallengeTab = 'popular' | 'latest' | 'ended' | 'mine';

/** 운영 상태. review·hidden 은 목록·피드에서 빠지고 남의 눈에는 404 다. */
export type ChallengeModeration = 'visible' | 'review' | 'hidden';

/** 기획팀(team)은 주최자가 없고, 사용자 개설(member)은 주최자가 있다(탈퇴하면 비어 있다). */
export type ChallengeOrigin = 'team' | 'member';

/** 참여자 미리보기 — 이름만 온다. 아바타는 앱이 첫 글자로 그린다. */
export type Participant = { name: string };

export type ChallengeCard = {
  id: string;
  line: string;
  work: string;
  character: string | null;
  scene_note: string | null;
  origin: ChallengeOrigin;
  /** 사용자 개설의 주최자 이름. 탈퇴했으면 null 이고 origin 은 member 그대로다. */
  host_name: string | null;
  /** 보는 사람이 이 챌린지의 주최자인지. 참여작이 없을 때만 지울 수 있다. */
  is_host?: boolean;
  starts_at: string;
  ends_at: string;
  featured_on: string | null;
  moderation: ChallengeModeration;
  entry_count: number;
  like_sum: number;
  /** 참여자 셋까지. 나머지는 more_count 로 센다. */
  participants: Participant[];
  more_count: number;
};

export type ChallengeListResponse = {
  /** 오늘의 챌린지. 없으면 null 이고 종료·내 챌린지 탭에서는 오지 않는다. */
  featured: ChallengeCard | null;
  challenges: ChallengeCard[];
  next_cursor: string | null;
};

/** 종료 랭킹이 굳기 전에는 pending 이고 화면은 "집계 중"이다. */
export type RankingState = 'pending' | 'final';

export type ChallengeDetail = ChallengeCard & {
  ranking_state: RankingState | null;
};

export type EntrySort = 'likes' | 'latest';

export type EntryCard = {
  id: string;
  author: Participant;
  caption: string | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  /** 서버가 계산한 순위(공동 순위). 최신순 조회에는 오지 않는다. */
  rank: number | null;
  /** 최초 공개 시각. 재공개해도 그대로다 — 최신순·동점 정렬의 기준. */
  published_at: string;
  playback_url: string | null;
  liked: boolean;
  saved: boolean;
};

export type EntriesResponse = {
  entries: EntryCard[];
  next_cursor: string | null;
};

export type CreateChallengeBody = {
  request_id: string;
  line: string;
  work: string;
  character?: string;
  scene_note?: string;
  duration_days: number;
};

/** 기간 선택지는 API 상수다(DB가 아니라). */
export const CHALLENGE_DURATIONS = [7, 14] as const;

export type ChallengeDuration = (typeof CHALLENGE_DURATIONS)[number];

/** 글자 수는 앱·서버가 같은 유니코드 코드 포인트로 센다(이모지 하나 = 1자). */
export const LINE_MAX = 200;
export const WORK_MAX = 100;
export const CHARACTER_MAX = 100;
export const SCENE_NOTE_MAX = 500;

/** 검색은 2자 이상일 때만 찾는다. */
export const SEARCH_MIN_LENGTH = 2;

/** 신고 사유 다섯 개(별도 선택지). 신고 전송은 CM3 다. */
export const REPORT_REASONS = ['copyright', 'sexual', 'violence', 'spam', 'other'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const CHALLENGE_ERROR_CODES = [
  'duplicate_challenge',
  'invalid_duration',
  'daily_challenge_limit',
  'request_fingerprint_mismatch',
  'challenge_has_entries',
  'challenge_closed',
  'member_only',
  'cursor_expired',
] as const;

export type ChallengeErrorCode = (typeof CHALLENGE_ERROR_CODES)[number];
