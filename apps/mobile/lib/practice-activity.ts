const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

export type ActivityDay = {
  /** 로컬 자정 기준 날짜 키 (YYYY-M-D). */
  key: string;
  label: string;
  count: number;
  isToday: boolean;
  /** 이번 주지만 아직 오지 않은 날. */
  isFuture: boolean;
};

export type WeekActivity = {
  days: ActivityDay[];
  /** 이번 주(월~오늘) 연습 횟수. */
  weekTotal: number;
  /** 오늘 또는 어제까지 이어진 연속 연습일. */
  streak: number;
};

/** 로컬 자정 기준 날짜 키. Date 객체 비교를 문자열 비교로 바꿔 타임존 흔들림을 없앤다. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * 홈 '연습 활동'에 쓸 이번 주(월요일 시작) 7일 스트립을 만든다.
 * 12주 히트맵이 너무 멀리 본다는 피드백에 따라 최근 1주만 보여준다.
 */
export function buildWeekActivity(
  records: readonly { created_at: string }[],
  now: Date = new Date(),
): WeekActivity {
  const counts = new Map<string, number>();
  for (const record of records) {
    const at = new Date(record.created_at);
    if (Number.isNaN(at.getTime())) continue; // 잘못된 날짜는 없는 셈 친다
    const key = dayKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS);

  const days: ActivityDay[] = [];
  let weekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday.getTime() + i * DAY_MS);
    const key = dayKey(date);
    const isFuture = date.getTime() > today.getTime();
    const count = isFuture ? 0 : (counts.get(key) ?? 0);
    weekTotal += count;
    days.push({ key, label: WEEKDAY_LABELS[i], count, isToday: key === todayKey, isFuture });
  }

  let streak = 0;
  for (let i = 0; ; i++) {
    const day = new Date(today.getTime() - i * DAY_MS);
    if (counts.has(dayKey(day))) streak++;
    else if (i === 0) continue; // 오늘 아직 안 했어도 어제까지의 연속은 유지
    else break;
  }

  return { days, weekTotal, streak };
}

/**
 * 연습 횟수 → 주간 스트립 색 단계(0=안 함, 1=1회, 2=2~3회, 3=4~5회, 4=6회 이상).
 * 색 값은 constants/palette의 weekColors가 같은 순서로 들고 있다.
 */
export function weekColorStep(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}
