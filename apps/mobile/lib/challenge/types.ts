/**
 * 챌린지 계약 타입(04-challenge). 챌린지는 대사 한 줄과 기간이고, 영상은 연습과 같은 videos 를 쓴다.
 *
 * 서버 계약(apps/api/spec/openapi.json, CONTRACT §6-16~§6-20)과 칸을 맞춘다. tests/challenge-api-contract 가
 * 실제 api.ts 호출을 서버 스키마로 대조한다.
 * 챌린지에는 다른 사람의 **현재 프로필 이름만** 보인다 — 사진·소개는 없고 아바타는 이름 첫 글자다.
 */

/** 대사 목록의 탭. 오늘의 챌린지는 인기·최신에만 고정한다. */
export type ChallengeTab = 'popular' | 'latest' | 'ended' | 'mine';

/** 운영 상태. review·hidden 은 목록·피드에서 빠지고 남의 눈에는 404 다. */
export type ChallengeModeration = 'visible' | 'review' | 'hidden';

/** 기획팀(team)은 주최자가 없고, 사용자 개설(member)은 주최자가 있다(탈퇴하면 비어 있다). */
export type ChallengeOrigin = 'team' | 'member';

/**
 * 참여자 미리보기 — 이름만 보인다(사진·소개는 없다). 아바타는 앱이 첫 글자로 그린다.
 * user_id 는 차단에 쓴다(화면에 보이지 않는다).
 */
export type Participant = { name: string; user_id: string };

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
  challenge_id: string;
  author: Participant;
  caption: string | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  /** 서버가 계산한 전체 기준 공동 순위. 최신순·좋아요가 모두 0·집계 중이면 null 이다. */
  rank: number | null;
  /** 종료 뒤 마감 때 저장된 좋아요 수. 진행 중이면 null 이다. */
  final_like_count: number | null;
  /** 최초 공개 시각. 재공개해도 그대로다 — 최신순·동점 정렬의 기준. 비공개로 만든 내 참여작은 null 이다. */
  published_at: string | null;
  playback_url: string | null;
  liked: boolean;
  saved: boolean;
  /** 보는 사람 자신의 참여작인지. 본인 재생은 조회수로 세지 않는다. */
  is_mine: boolean;
  /** 최신순에서 가장 최근 참여작 하나에만 참이다. */
  is_new: boolean;
};

export type EntriesResponse = {
  entries: EntryCard[];
  next_cursor: string | null;
  /** 종료 랭킹의 상태. 진행 중이면 null, 마감 집계 뒤 확정 전이면 pending("집계 중")이다. */
  ranking_state: RankingState | null;
};

// ─── 참여작(challenge.entry) ─────────────────────────────────────────────────

/** 공개 범위. 올리기 화면에서 명시적으로 고른다(미리 선택 없음). */
export type EntryVisibility = 'public' | 'private';

/** 신고 숨김은 작성자가 풀 수 없고, 삭제는 행을 남긴 채 표시만 바뀐다. */
export type EntryStatus = 'visible' | 'hidden_by_report' | 'deleted';

/** 챌린지 영상은 60초 이내다(촬영 상한도 같다). */
export const ENTRY_VIDEO_MAX_SEC = 60;

/** 캡션은 300자까지, 선택이다. */
export const CAPTION_MAX = 300;

export type CreateEntryBody = {
  request_id: string;
  video_id: string;
  caption?: string;
  visibility: EntryVisibility;
};

export type EntryPatch = {
  caption?: string;
  visibility?: EntryVisibility;
};

/** P03 내 참여작 — 분류와 부모 챌린지가 함께 온다. */
export type MyEntryCard = Omit<EntryCard, 'is_new'> & {
  /** 캡션을 고칠 때마다 오른다(신고의 target_version 과 대조). */
  content_version: number;
  visibility: EntryVisibility;
  status: EntryStatus;
  /** 서버가 매긴 P03 분류 — 확인 중 → 비공개 → 공개 순으로 한 곳에만 든다. */
  category: 'public' | 'private' | 'under_review';
  /** 부모 챌린지가 review·hidden 이면 참여작도 확인 중으로 보인다. */
  challenge_hidden: boolean;
  challenge: { id: string; line: string; work: string; character: string | null; ends_at: string };
  created_at: string;
};

export type MyEntriesResponse = {
  counts: { all: number; public: number; private: number; under_review: number };
  entries: MyEntryCard[];
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

/** 신고 사유 다섯 개. 화면(A15.4)은 각각을 선택지로 둔다. */
export const REPORT_REASONS = ['copyright', 'inappropriate', 'spam', 'duplicate', 'other'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** 신고 대상은 참여작·댓글·챌린지 셋이다. */
export type ReportTarget = 'entry' | 'comment' | 'challenge';

export const REPORT_NOTE_MAX = 200;

export type ReportBody = {
  request_id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  note?: string;
};

// ─── 댓글(challenge.react) ───────────────────────────────────────────────────

export const COMMENT_MAX = 500;

/** 한 겹 댓글(답글 없음). 작성자 이름은 현재 프로필 이름이고 탈퇴하면 이름만 바뀐다. */
export type EntryComment = {
  id: string;
  author: Participant;
  body: string | null;
  created_at: string;
  /** 본인 댓글인지 — 본인만 지울 수 있다. */
  is_mine: boolean;
  /** 작성자가 탈퇴했다 — 이름 자리에 "탈퇴한 사용자"를 보인다. */
  author_withdrawn: boolean;
  /** 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로 나에게만 보인다. */
  status: 'visible' | 'hidden';
};

export type CommentsResponse = {
  comments: EntryComment[];
  next_cursor: string | null;
};

export type CreateCommentBody = {
  request_id: string;
  body: string;
};

// ─── AI 리포트(challenge.ai-report) ──────────────────────────────────────────

export type AiReportStatus = 'pending' | 'ready' | 'failed';

/** 관찰·견주기에 붙는 근거 구간. 그 자리를 다시 볼 수 있게 시각을 준다. */
export type ReportEvidence = { start_ms: number; end_ms: number; text: string };

/**
 * 리포트는 관찰·견주기·한계·제안이다. 점수·백분위·등급·순위·재능 판정은 없다(ADR-005 개정).
 * 표본은 이름·id 없이 "다른 참여작들"로만 나온다.
 */
export type AiReport = {
  entry_id: string;
  status: AiReportStatus;
  /** 내 영상에서 확인된 것. */
  observations: ReportEvidence[];
  /** 표본에서 자주 보인 선택과 내 선택의 차이(우열 없이). 표본이 부족하면 빈 목록이다. */
  comparisons: string[];
  /** 못 본 구간·표본 부족 같은 한계. 채우지 않는다. */
  limits: string[];
  /** 다음에 해볼 것 하나. 없을 수 있다. */
  suggestion: string | null;
  /** 견주기에 쓴 표본 수. 3개 미만이면 화면이 "비교할 영상이 아직 부족해요"를 보인다. */
  sample_count: number;
  /** 이번 생성의 실행 수(최대 3). */
  attempt_count: number;
  requested_at: string | null;
  completed_at: string | null;
};

/** 하루에 새로 만들 수 있는 리포트 수. */
export const AI_REPORT_DAILY_LIMIT = 3;

/** 견주기를 만들려면 표본이 이만큼은 있어야 한다. */
export const AI_REPORT_MIN_SAMPLES = 3;

// ─── 알림함(challenge.notification) ──────────────────────────────────────────

export type NotificationKind =
  | 'entry_liked'
  | 'entry_commented'
  | 'challenge_ended'
  | 'entry_ai_report_ready';

/**
 * 알림함의 한 줄 = 묶음 하나. 같은 group_key(10분 구간)의 좋아요·댓글이 한 줄로 묶인다.
 * 이름·본문·주소는 복사하지 않고 조회 때 현재 권한으로 조립된다.
 */
export type NotificationGroup = {
  group_key: string;
  kind: NotificationKind;
  /** 유효한(취소·삭제되지 않은) 서로 다른 행동자 수. 시스템 사건은 0 이다. */
  actor_count: number;
  /** 유효한 사건 수 — 댓글 묶음은 댓글 수다. */
  event_count: number;
  /** 대표 행동자 이름. 탈퇴했으면 서버가 "탈퇴한 사용자"로 준다. */
  actor_name: string | null;
  challenge_id: string;
  entry_id: string | null;
  comment_id: string | null;
  /** 최신 댓글의 앞부분(볼 수 있을 때만). 행에는 복사하지 않고 조회 때 조립한다. */
  comment_excerpt: string | null;
  /** 묶음의 최신 사건 시각. 목록은 이 순서의 역순이다. */
  latest_at: string;
  /** 포함된 사건이 모두 읽혔는지. */
  read: boolean;
  /** 대상이 삭제·비공개·숨김·차단으로 보이지 않으면 거짓이다(본인 리포트는 예외). */
  target_available: boolean;
};

export type NotificationsResponse = {
  groups: NotificationGroup[];
  next_cursor: string | null;
};

// ─── 차단(challenge.block) ───────────────────────────────────────────────────

export type BlockedUser = {
  user_id: string;
  name: string;
  created_at: string;
};

export const CHALLENGE_ERROR_CODES = [
  'duplicate_challenge',
  'duplicate_entry',
  'video_not_ready',
  'video_too_long',
  'daily_entry_limit',
  'entry_hidden',
  'self_like',
  'self_save',
  'self_block',
  'self_report',
  'daily_comment_limit',
  'daily_report_limit',
  'invalid_duration',
  'daily_challenge_limit',
  'request_fingerprint_mismatch',
  'challenge_has_entries',
  'challenge_closed',
  'member_only',
  'cursor_expired',
  'daily_report_request_limit',
  'entry_not_found',
  'video_not_found',
  'comment_not_found',
  'user_not_found',
  'ai_report_not_found',
  'challenge_not_found',
  'account_deactivated',
] as const;

export type ChallengeErrorCode = (typeof CHALLENGE_ERROR_CODES)[number];
