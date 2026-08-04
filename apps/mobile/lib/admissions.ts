/**
 * 연기 입시 공고. 서버가 사람이 확인해 채운 파일을 그대로 내려준다.
 *
 * 정렬과 D-day 계산은 웹(`apps/web/src/lib/api/v2/admissions.ts`)과 같은 규칙을 쓴다.
 * 두 화면이 다른 순서를 보여주면 같은 서비스로 보이지 않는다.
 */

export type AdmissionResource = {
  kind: string;
  title: string;
  url: string;
  publisher: string;
  /** official(대학 공식) | school(고교) | academy(입시학원) | personal(개인) */
  source_type: string;
  note?: string | null;
};

export type AdmissionResult = {
  year: number;
  competition_rate?: string | null;
  transcript_avg?: string | null;
  transcript_cut70?: string | null;
  practical_avg?: string | null;
  practical_cut70?: string | null;
  fill_rate?: string | null;
  waitlist_last?: number | null;
  note?: string | null;
};

export type AdmissionNotice = {
  id: string;
  university_id: string;
  department?: string | null;
  track?: string | null;
  screening?: string | null;
  apply_start?: string | null;
  apply_end?: string | null;
  practical_date?: string | null;
  practical_task?: string | null;
  quota?: string | null;
  fee?: string | null;
  csat_minimum?: string | null;
  documents?: string | null;
  dress_code?: string | null;
  designated_works: string[];
  essay_questions: string[];
  results: AdmissionResult[];
  source_url?: string | null;
  note?: string | null;
};

export type AdmissionUniversity = {
  id: string;
  name: string;
  admission_url: string;
  region?: string | null;
  note?: string | null;
  resources: AdmissionResource[];
};

export type AdmissionsResponse = {
  updated_at: string;
  disclaimer: string;
  universities: AdmissionUniversity[];
  notices: AdmissionNotice[];
};

export type UniversityGroup = {
  university: AdmissionUniversity;
  notices: AdmissionNotice[];
};

/** 자료 출처. 학원 홍보를 대학 공식 자료와 같은 무게로 보여주면 안 된다. */
export const SOURCE_LABEL: Record<string, string> = {
  official: '대학 공식',
  school: '고등학교',
  academy: '입시학원',
  personal: '개인',
};

const NO_DATE = '8:9999-99-99';

/** 접수 마감일이 지나지 않았으면 열린 것으로 본다. 날짜를 모르면 닫혔다고 단정하지 않는다. */
export function isOpen(notice: AdmissionNotice, today: string): boolean {
  if (!notice.apply_end) return true;
  return notice.apply_end >= today;
}

/** 접수 중·예정 → 날짜 미확인 → 이미 끝난 전형 순. 앞자리 숫자가 세 뭉치를 가른다. */
function sortKey(notice: AdmissionNotice, today?: string | null): string {
  const start = notice.apply_start ?? notice.apply_end;
  if (!start) return NO_DATE;
  if (today && !isOpen(notice, today)) return `9:${start}`;
  return `1:${start}`;
}

function groupKey(notices: AdmissionNotice[], today?: string | null): string {
  // 초기값을 NO_DATE로 두면 안 된다. 마감된 전형 키("9:")가 NO_DATE("8:")보다 커서
  // 절대 채택되지 않고, 공고가 전부 마감된 대학이 '날짜 미확인'과 같은 자리로 묶인다.
  if (notices.length === 0) return NO_DATE;
  return notices.reduce(
    (earliest, notice) => (sortKey(notice, today) < earliest ? sortKey(notice, today) : earliest),
    sortKey(notices[0], today),
  );
}

/**
 * 공고를 대학별로 묶는다. 공고가 없는 대학도 링크는 남긴다.
 * 접수가 빠른 대학부터 세우고, 끝난 전형과 날짜 미확인은 뒤로 보낸다.
 */
export function groupByUniversity(
  payload: AdmissionsResponse,
  today?: string | null,
): UniversityGroup[] {
  return payload.universities
    .map((university) => ({
      university,
      notices: payload.notices
        .filter((notice) => notice.university_id === university.id)
        .sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today))),
    }))
    .sort((a, b) => groupKey(a.notices, today).localeCompare(groupKey(b.notices, today)));
}

export type Countdown = { label: string; days: number };

/**
 * 접수 시작까지 남은 날. 이미 시작했으면 마감까지 남은 날.
 * 날짜가 없거나 이미 끝났으면 null — 화면에서 배지를 숨긴다.
 */
export function countdown(notice: AdmissionNotice, today: string): Countdown | null {
  const days = (target: string) =>
    Math.round(
      (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );

  if (notice.apply_start && notice.apply_start > today) {
    return { label: '접수 시작', days: days(notice.apply_start) };
  }
  if (notice.apply_end && notice.apply_end >= today) {
    return { label: '접수 마감', days: days(notice.apply_end) };
  }
  return null;
}

/** 홈 카드에 띄울 가장 임박한 공고 몇 개. */
export function upcomingNotices(
  payload: AdmissionsResponse,
  today: string,
  limit: number,
): { university: AdmissionUniversity; notice: AdmissionNotice; remaining: Countdown }[] {
  return groupByUniversity(payload, today)
    .flatMap(({ university, notices }) => notices.map((notice) => ({ university, notice })))
    .map((row) => ({ ...row, remaining: countdown(row.notice, today) }))
    .filter((row): row is { university: AdmissionUniversity; notice: AdmissionNotice; remaining: Countdown } =>
      row.remaining !== null,
    )
    .slice(0, limit);
}

/** 사용자가 사는 시간대의 오늘. UTC로 자르면 한국 오전에 하루가 밀린다. */
export function localDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 검색 상자에 친 말로 대학·학과를 거른다. 비어 있으면 전부 남긴다. */
export function matchesQuery(group: UniversityGroup, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    group.university.name,
    group.university.region ?? '',
    ...group.notices.map((n) => `${n.department ?? ''} ${n.screening ?? ''}`),
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function periodText(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}
