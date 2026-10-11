/**
 * 오디션 공고 모아보기 (app.audition, ADR-034).
 *
 * 서버가 지금 지원할 수 있는 공고만 내려준다(열림 판정은 서버 몫). 여기는 화면이 쓰는
 * 순수 계산뿐이다 — D-day, 마감 구간, 분야 묶음, 검색, 홈 카드용 임박 공고.
 * CI mobile 잡이 설치 없이 node --test로 돌리므로 이 파일은 아무것도 import하지 않는다.
 */

export type AuditionCategory =
  | 'film'
  | 'short_film'
  | 'drama'
  | 'web_drama'
  | 'short_form'
  | 'commercial'
  | 'music_video'
  | 'theater'
  | 'musical'
  | 'agency_open'
  | 'other';

export type AuditionPosting = {
  /** `<source>-<source_ref>`. 기기의 찜·봤음 저장 열쇠. */
  id: string;
  title: string;
  /** 서버가 분야를 늘려도 화면이 죽지 않게 string까지 받는다 — 모르는 값은 기타로 묶는다. */
  category: AuditionCategory | string;
  source: string;
  source_name: string;
  /** 출연료 문구 원문. 숫자로 바꾸지 않는다. */
  pay_text?: string | null;
  apply_start?: string | null;
  apply_end?: string | null;
  status_text?: string | null;
  posted_on?: string | null;
  source_url: string;
};

export type AuditionPostingList = {
  items: AuditionPosting[];
  /** 수집이 한 번도 성공하지 않았으면 null. */
  collected_at: string | null;
};

/** 기능이 꺼진 서버·빠진 키도 빈 목록으로 받는다 — 화면이 `items.length`를 바로 읽는다. */
export function normalizeAuditions(
  payload: Partial<AuditionPostingList> | null | undefined,
): AuditionPostingList {
  return {
    items: payload?.items ?? [],
    collected_at: payload?.collected_at ?? null,
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * 한국 시간의 오늘(YYYY-MM-DD). 공고의 날짜가 전부 KST라 기기 시간대가 아니라 KST로 자른다 —
 * 해외에 있는 한국어 사용자도 서버와 같은 날짜로 D-day를 본다.
 */
export function kstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** target까지 남은 날. 오늘이면 0, 지났으면 음수, 날짜가 없으면 null. */
export function daysUntil(target: string | null | undefined, today: string): number | null {
  if (!target) return null;
  const diff = Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(diff)) return null;
  return Math.round(diff / DAY_MS);
}

const CATEGORIES: readonly string[] = [
  'film',
  'short_film',
  'drama',
  'web_drama',
  'short_form',
  'commercial',
  'music_video',
  'theater',
  'musical',
  'agency_open',
  'other',
];

/** 분야 이름의 번역 키 조각. 모르는 분야는 기타로 읽는다. */
export function categoryKey(category: string): AuditionCategory {
  return (CATEGORIES.includes(category) ? category : 'other') as AuditionCategory;
}

/** 이번 주(≤7일) / 2주 안(≤14일) / 여유 있음 / 마감일 원문 확인. 화면의 섹션 순서와 같다. */
export const DEADLINE_BUCKETS = ['week', 'twoWeeks', 'later', 'unknown'] as const;
export type DeadlineBucket = (typeof DEADLINE_BUCKETS)[number];

export function deadlineBucket(posting: AuditionPosting, today: string): DeadlineBucket {
  const days = daysUntil(posting.apply_end, today);
  if (days === null) return 'unknown';
  if (days <= 7) return 'week';
  if (days <= 14) return 'twoWeeks';
  return 'later';
}

/** 분야 칩. 순서가 곧 칩 순서다. 이름은 화면이 `auditions.groups.<key>`로 번역한다. */
export const AUDITION_GROUPS = [
  { key: 'all', categories: [] },
  { key: 'screen', categories: ['film', 'short_film', 'drama', 'web_drama'] },
  { key: 'shortForm', categories: ['short_form'] },
  { key: 'ad', categories: ['commercial', 'music_video'] },
  { key: 'theater', categories: ['theater'] },
  { key: 'musical', categories: ['musical'] },
  { key: 'agency', categories: ['agency_open'] },
  { key: 'other', categories: ['other'] },
] as const;
export type AuditionGroupKey = (typeof AUDITION_GROUPS)[number]['key'];

/** 공고 분야 → 칩. 모르는 분야는 기타 — 서버가 분야를 늘려도 공고가 사라지지 않는다. */
export function groupOf(category: string): Exclude<AuditionGroupKey, 'all'> {
  for (const group of AUDITION_GROUPS) {
    if ((group.categories as readonly string[]).includes(category)) {
      return group.key as Exclude<AuditionGroupKey, 'all'>;
    }
  }
  return 'other';
}

/** 칩마다 건수. 0건 칩은 빼되 「전체」는 늘 남긴다. */
export function groupCounts(items: AuditionPosting[]): { key: AuditionGroupKey; count: number }[] {
  const counts = new Map<AuditionGroupKey, number>();
  for (const item of items) {
    const key = groupOf(item.category);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return AUDITION_GROUPS.map(({ key }) => ({
    key,
    count: key === 'all' ? items.length : (counts.get(key) ?? 0),
  })).filter(({ key, count }) => key === 'all' || count > 0);
}

/** 검색 — 제목·출연료 문구·출처 이름. 공백으로 나눈 말이 모두 들어 있어야 남긴다. */
export function matchesAuditionQuery(posting: AuditionPosting, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [posting.title, posting.pay_text ?? '', posting.source_name].join(' ').toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** 출연료가 적혀 있는지. 「협의」는 금액이 아니다. */
export function hasPay(posting: AuditionPosting): boolean {
  const text = posting.pay_text?.trim();
  if (!text) return false;
  return !text.startsWith('협의');
}

/** 게시 1일 이내면 NEW. */
export function isNewPosting(posting: AuditionPosting, today: string): boolean {
  const days = daysUntil(posting.posted_on, today);
  return days !== null && days >= -1 && days <= 0;
}

export type AuditionFilters = {
  query: string;
  group: AuditionGroupKey;
  /** 7일 안에 마감 */
  week: boolean;
  /** 출연료 명시 */
  paid: boolean;
  /** 찜한 공고 */
  starred: boolean;
};

export const EMPTY_AUDITION_FILTERS: AuditionFilters = {
  query: '',
  group: 'all',
  week: false,
  paid: false,
  starred: false,
};

/**
 * 필터를 건다. 마감일이 이미 지난 공고는 늘 뺀다 — 서버는 열린 것만 주지만, 화면을 연 채
 * 자정을 넘기면 어제 마감이 남는다.
 */
export function filterAuditions(
  items: AuditionPosting[],
  filters: AuditionFilters,
  today: string,
  starredIds: ReadonlySet<string>,
): AuditionPosting[] {
  return items.filter((item) => {
    const days = daysUntil(item.apply_end, today);
    if (days !== null && days < 0) return false;
    if (filters.group !== 'all' && groupOf(item.category) !== filters.group) return false;
    if (filters.week && (days === null || days > 7)) return false;
    if (filters.paid && !hasPay(item)) return false;
    if (filters.starred && !starredIds.has(item.id)) return false;
    return matchesAuditionQuery(item, filters.query);
  });
}

/** 마감 빠른 순, 같으면(또는 마감일이 없으면) 최근 게시 순. */
function compareDeadline(a: AuditionPosting, b: AuditionPosting): number {
  const endA = a.apply_end ?? '9999-99-99';
  const endB = b.apply_end ?? '9999-99-99';
  if (endA !== endB) return endA < endB ? -1 : 1;
  return (b.posted_on ?? '').localeCompare(a.posted_on ?? '');
}

/** SectionList에 바로 넣는 마감 구간. 빈 구간은 없다. */
export function auditionSections(
  items: AuditionPosting[],
  today: string,
): { bucket: DeadlineBucket; data: AuditionPosting[] }[] {
  const buckets = new Map<DeadlineBucket, AuditionPosting[]>();
  for (const item of items) {
    const bucket = deadlineBucket(item, today);
    const list = buckets.get(bucket);
    if (list) list.push(item);
    else buckets.set(bucket, [item]);
  }
  return DEADLINE_BUCKETS.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    bucket,
    data: [...(buckets.get(bucket) ?? [])].sort(compareDeadline),
  }));
}

/** 홈 카드 — 마감일이 있고 아직 안 지난 공고를 가까운 순으로 limit개. */
export function urgentAuditions(
  items: AuditionPosting[],
  today: string,
  limit: number,
): { posting: AuditionPosting; days: number }[] {
  return items
    .map((posting) => ({ posting, days: daysUntil(posting.apply_end, today) }))
    .filter((row): row is { posting: AuditionPosting; days: number } => row.days !== null && row.days >= 0)
    .sort((a, b) => a.days - b.days || compareDeadline(a.posting, b.posting))
    .slice(0, limit);
}

/** "2026-10-08" → "10/8". 못 읽으면 빈 문자열. */
export function shortDate(date: string | null | undefined): string {
  const match = date?.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!match) return '';
  return `${Number(match[1])}/${Number(match[2])}`;
}
