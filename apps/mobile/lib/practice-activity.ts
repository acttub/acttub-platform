import { translateList } from './i18n.ts';

const WEEKDAY_LABELS = translateList('home.weekdays');

export type ActivityDay = {
  /** 로컬 자정 기준 날짜 키 (YYYY-M-D). */
  key: string;
  label: string;
  count: number;
  isToday: boolean;
  /** 아직 오지 않은 날(최근 7일에는 없다). */
  isFuture: boolean;
};

export type WeekActivity = {
  days: ActivityDay[];
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
 * 홈 「이번 주 연습」에 쓸 최근 7일 — 오늘이 맨 오른쪽이고 앞 6일이 왼쪽으로 이어진다. 요일 이름은 그 날짜의
 * 요일이라 월~일 고정 순서가 아니다. 모두 오늘까지라 미래 칸은 없다.
 */
export function buildRecentActivity(
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
  const days: ActivityDay[] = [];
  for (let back = 6; back >= 0; back--) {
    // 날짜 빼기는 setDate 로 — 서머타임이 있는 곳에서도 하루씩 정확히 옮긴다.
    const date = new Date(today.getTime());
    date.setDate(today.getDate() - back);
    const key = dayKey(date);
    days.push({ key, label: WEEKDAY_LABELS[(date.getDay() + 6) % 7], count: counts.get(key) ?? 0, isToday: back === 0, isFuture: false });
  }
  return { days };
}
