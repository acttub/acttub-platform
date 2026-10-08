/**
 * 오디션 공고 모아보기의 순수 계산 (app.audition, ADR-034).
 *
 * 서버가 지금 지원할 수 있는 공고만 내려준다(열림 계산은 서버 몫). 여기는 화면이 쓰는 D-day·마감 구간·
 * 분야 묶음·검색뿐이다. 모바일 apps/mobile/lib/auditions.ts 와 같은 답을 내야 한다 — 공유 패키지는
 * 두지 않고(packages/* 규칙) 두 벌을 테스트로 맞춘다.
 */

import type { AuditionPosting } from "@/lib/api/v2/auditions";

/** 화면이 읽는 칸만. 서버가 칸을 늘려도 계산은 그대로다. */
type Posting = Pick<
  AuditionPosting,
  "id" | "title" | "category" | "source_name" | "pay_text" | "apply_end" | "posted_on"
>;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** 한국 시간의 오늘. 공고 날짜가 전부 KST라 기기 시간대가 아니라 KST로 자른다. */
export function kstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** target까지 남은 날. 오늘이면 0, 지났으면 음수, 날짜가 없거나 못 읽으면 null. */
export function daysUntil(target: string | null | undefined, today: string): number | null {
  if (!target) return null;
  const diff = Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(diff)) return null;
  return Math.round(diff / DAY_MS);
}

export const CATEGORY_LABEL: Record<string, string> = {
  film: "영화",
  short_film: "단편영화",
  drama: "드라마",
  web_drama: "웹드라마",
  short_form: "숏폼",
  commercial: "광고",
  music_video: "뮤비",
  theater: "연극",
  musical: "뮤지컬",
  agency_open: "기획사",
  other: "기타",
};

/** 분야 칩. 순서가 곧 칩 순서다. */
export const AUDITION_GROUPS = [
  { key: "all", label: "전체", categories: [] },
  { key: "screen", label: "영화·드라마", categories: ["film", "short_film", "drama", "web_drama"] },
  { key: "shortForm", label: "숏폼", categories: ["short_form"] },
  { key: "ad", label: "광고·뮤비", categories: ["commercial", "music_video"] },
  { key: "theater", label: "연극", categories: ["theater"] },
  { key: "musical", label: "뮤지컬", categories: ["musical"] },
  { key: "agency", label: "기획사", categories: ["agency_open"] },
  { key: "other", label: "기타", categories: ["other"] },
] as const;
export type AuditionGroupKey = (typeof AUDITION_GROUPS)[number]["key"];

/** 공고 분야 → 칩. 모르는 분야는 기타 — 서버가 분야를 늘려도 공고가 사라지지 않는다. */
export function groupOf(category: string): Exclude<AuditionGroupKey, "all"> {
  for (const group of AUDITION_GROUPS) {
    if ((group.categories as readonly string[]).includes(category)) {
      return group.key as Exclude<AuditionGroupKey, "all">;
    }
  }
  return "other";
}

/** 칩마다 건수. 0건 칩은 빼되 「전체」는 늘 남긴다. */
export function groupCounts(items: Posting[]): { key: AuditionGroupKey; count: number }[] {
  const counts = new Map<AuditionGroupKey, number>();
  for (const item of items) {
    const key = groupOf(item.category);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return AUDITION_GROUPS.map(({ key }) => ({
    key,
    count: key === "all" ? items.length : (counts.get(key) ?? 0),
  })).filter(({ key, count }) => key === "all" || count > 0);
}

/** 이번 주(≤7일) / 2주 안(≤14일) / 여유 있음 / 마감일 원문 확인. 화면의 섹션 순서와 같다. */
export const DEADLINE_BUCKETS = ["week", "twoWeeks", "later", "unknown"] as const;
export type DeadlineBucket = (typeof DEADLINE_BUCKETS)[number];

export const BUCKET_LABEL: Record<DeadlineBucket, string> = {
  week: "이번 주 마감",
  twoWeeks: "2주 안",
  later: "여유 있음",
  unknown: "마감일은 원문 확인",
};

export function deadlineBucket(posting: Posting, today: string): DeadlineBucket {
  const days = daysUntil(posting.apply_end, today);
  if (days === null) return "unknown";
  if (days <= 7) return "week";
  if (days <= 14) return "twoWeeks";
  return "later";
}

/** 출연료가 적혀 있는지. 「협의」는 금액이 아니다. */
export function hasPay(posting: Posting): boolean {
  const text = posting.pay_text?.trim();
  if (!text) return false;
  return !text.startsWith("협의");
}

/** 게시 1일 이내면 NEW. */
export function isNewPosting(posting: Posting, today: string): boolean {
  const days = daysUntil(posting.posted_on, today);
  return days !== null && days >= -1 && days <= 0;
}

/** 검색 — 제목·출연료 문구·출처 이름. 공백으로 나눈 말이 모두 들어 있어야 남긴다. */
export function matchesAuditionQuery(posting: Posting, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [posting.title, posting.pay_text ?? "", posting.source_name].join(" ").toLowerCase();
  return words.every((word) => hay.includes(word));
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
  query: "",
  group: "all",
  week: false,
  paid: false,
  starred: false,
};

/**
 * 필터를 건다. 마감일이 이미 지난 공고는 늘 뺀다 — 서버는 열린 것만 주지만, 화면을 연 채
 * 자정을 넘기면 어제 마감이 남는다.
 */
export function filterAuditions<T extends Posting>(
  items: T[],
  filters: AuditionFilters,
  today: string,
  starredIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => {
    const days = daysUntil(item.apply_end, today);
    if (days !== null && days < 0) return false;
    if (filters.group !== "all" && groupOf(item.category) !== filters.group) return false;
    if (filters.week && (days === null || days > 7)) return false;
    if (filters.paid && !hasPay(item)) return false;
    if (filters.starred && !starredIds.has(item.id)) return false;
    return matchesAuditionQuery(item, filters.query);
  });
}

/** 마감 빠른 순, 같으면(또는 마감일이 없으면) 최근 게시 순. */
function compareDeadline(a: Posting, b: Posting): number {
  const endA = a.apply_end ?? "9999-99-99";
  const endB = b.apply_end ?? "9999-99-99";
  if (endA !== endB) return endA < endB ? -1 : 1;
  return (b.posted_on ?? "").localeCompare(a.posted_on ?? "");
}

/** 마감 구간. 빈 구간은 없다. */
export function auditionSections<T extends Posting>(
  items: T[],
  today: string,
): { bucket: DeadlineBucket; data: T[] }[] {
  const buckets = new Map<DeadlineBucket, T[]>();
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

/** "2026-10-08" → "10/8". 못 읽으면 빈 문자열. */
export function shortDate(date: string | null | undefined): string {
  const match = date?.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

export type DdayTone = "urgent" | "soon" | "calm" | "none";

/**
 * 카드 왼쪽 D-day 칸. 색은 남은 시간의 급함만 나타낸다(3일 안 / 7일 안 / 그 뒤).
 * 날짜를 모르면 D-day를 지어내지 않고 원문을 보라고 적는다.
 */
export function ddayLabel(
  posting: Posting,
  today: string,
): { main: string; sub: string; tone: DdayTone } {
  const days = daysUntil(posting.apply_end, today);
  if (days === null) return { main: "미표기", sub: "원문 확인", tone: "none" };
  const sub = `${shortDate(posting.apply_end)} 마감`;
  if (days < 0) return { main: "마감", sub, tone: "none" };
  return {
    main: days === 0 ? "D-DAY" : `D-${days}`,
    sub,
    tone: days <= 3 ? "urgent" : days <= 7 ? "soon" : "calm",
  };
}

/** 마지막 수집이 지금으로부터 얼마 전인지. 수집한 적이 없거나 못 읽으면 null. */
export function collectedAgo(collectedAt: string | null | undefined, now: number): string | null {
  if (!collectedAt) return null;
  const at = Date.parse(collectedAt);
  if (Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
