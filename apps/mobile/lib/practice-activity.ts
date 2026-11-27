import { translateList } from './i18n.ts';

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
    days.push({ key, label: translateList('home.weekdays')[(date.getDay() + 6) % 7], count: counts.get(key) ?? 0, isToday: back === 0, isFuture: false });
  }
  return { days };
}

/**
 * 「이번 주 연습」 원에 쓸 날마다 연습 횟수 — max(그 날이 연습한 날이면 1, 그 날 센 연습 기록 수).
 * days 는 buildRecentActivity 결과(하루 하나로 합친 날짜라 0/1), practices 는 시각이 있는 센 연습(코칭·리딩·챌린지)이다.
 * 날짜는 dayKey(기기 로컬 자정) 그대로 쓴다.
 */
export function withPracticeCounts(days: readonly ActivityDay[], practices: readonly { at: string }[]): ActivityDay[] {
  const counts = new Map<string, number>();
  for (const practice of practices) {
    const at = new Date(practice.at);
    if (Number.isNaN(at.getTime())) continue; // 잘못된 날짜는 없는 셈 친다
    const key = dayKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return days.map((d) => ({ ...d, count: Math.max(d.count > 0 ? 1 : 0, counts.get(d.key) ?? 0) }));
}

/** 원이 아래에서부터 차오르는 높이(%) — 1번 30, 2번 55, 3~4번 80, 5번 이상 100. 연습 없으면 0. */
export function practiceFillPercent(count: number): number {
  if (count >= 5) return 100;
  if (count >= 3) return 80;
  if (count === 2) return 55;
  if (count === 1) return 30;
  return 0;
}
