/**
 * 웹 게스트의 하루 3회 분석 한도 안내(practice.start·practice.resume). 한도는 서버가 한국 시간 하루의 새 분석
 * 요청 수로 세고(429 guest_daily_analysis_limit), 웹은 시작 전에 이를 알린다. 기기는 오늘 시작한 횟수를 세어
 * 둘 뿐이고 서버가 정본이다.
 */

export const GUEST_DAILY_LIMIT = 3;
const KEY = "acttub.practice.guest_daily";

type CountStore = Pick<Storage, "getItem" | "setItem">;

/** 한국 시간 날짜 "YYYY-MM-DD" */
export function kstDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function store(): CountStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(s: CountStore | null, now: Date): number {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date: string; count: number };
    return parsed.date === kstDate(now) ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export function guestAnalysisUsed(s: CountStore | null = store(), now: Date = new Date()): number {
  return read(s, now);
}

export function recordGuestAnalysis(s: CountStore | null = store(), now: Date = new Date()): void {
  try {
    s?.setItem(KEY, JSON.stringify({ date: kstDate(now), count: read(s, now) + 1 }));
  } catch {
    /* 저장이 막힌 환경 */
  }
}

export function guestAnalysisNotice(used: number): string {
  const left = Math.max(0, GUEST_DAILY_LIMIT - used);
  if (left === 0) return "오늘은 세 번까지 분석할 수 있어요. 앱으로 옮기면 계속할 수 있어요.";
  return `게스트는 하루 ${GUEST_DAILY_LIMIT}번까지 분석할 수 있어요. 오늘 ${left}번 남았어요.`;
}
