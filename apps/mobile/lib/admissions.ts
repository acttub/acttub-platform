/**
 * 연기 입시 공고. 서버가 사람이 확인해 채운 파일을 그대로 내려준다.
 *
 * 정렬·D-day·필터 규칙은 웹(`apps/web/src/lib/api/v2/admissions.ts`)과 같아야 한다.
 * 두 화면이 다른 순서나 다른 개수를 보여주면 같은 서비스로 보이지 않는다.
 *
 * 왜 복제인가: pnpm-workspace.yaml이 apps/mobile을 워크스페이스에서 빼 두었다
 * (pnpm 심링크가 Metro를 깬다). 공용 패키지로 뺄 수 없어 손으로 맞춘다 —
 * 한쪽을 고치면 반드시 다른 쪽도 고치고, tests/admissions.test.mjs로 계약을 고정한다.
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
  waitlist_count?: number | null;
  note?: string | null;
};

export type AdmissionWeights = {
  practical?: number | null;
  transcript?: number | null;
  csat?: number | null;
  interview?: number | null;
  portfolio?: number | null;
  other?: number | null;
};

export type AdmissionStage = {
  order: number;
  name: string;
  date?: string | null;
  evaluates: string[];
  multiple?: string | null;
  weight?: number | null;
  note?: string | null;
};

export type AdmissionPracticalItem = {
  category: string;
  label?: string | null;
  required?: boolean | null;
  time_limit_sec?: number | null;
  count?: number | null;
  weight?: number | null;
  stage?: number | null;
  note?: string | null;
};

export type AdmissionNotice = {
  id: string;
  university_id: string;
  department?: string | null;
  /** acting(연기·연극) | musical(뮤지컬) */
  discipline?: string | null;
  track?: string | null;
  screening?: string | null;
  apply_start?: string | null;
  apply_end?: string | null;
  practical_date?: string | null;
  practical_date_end?: string | null;
  announce_date?: string | null;
  practical_task?: string | null;
  quota?: string | null;
  fee?: string | null;
  csat_minimum?: string | null;
  documents?: string | null;
  dress_code?: string | null;
  preparation?: string | null;
  designated_works: string[];
  essay_questions: string[];
  weights?: AdmissionWeights | null;
  weights_note?: string | null;
  stages: AdmissionStage[];
  practical_items: AdmissionPracticalItem[];
  results: AdmissionResult[];
  source_url?: string | null;
  note?: string | null;
};

export type AdmissionUniversity = {
  id: string;
  name: string;
  admission_url: string;
  region?: string | null;
  campus?: string | null;
  /** univ(4년제) | college(전문대) */
  type?: string | null;
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

/**
 * 리스트 필드를 빈 배열로 채운다.
 *
 * 화면 곳곳이 `notice.stages.length`처럼 바로 읽는다. 응답에서 그 키가 빠지면
 * 화면 전체가 죽는다 — 공고 하나가 덜 보이는 것과는 무게가 다르다. 소비자마다
 * `?? []`를 흩뿌리는 대신 들어오는 자리에서 한 번 메운다. 웹도 같은 규칙이다.
 */
export function normalizeAdmissions(payload: AdmissionsResponse): AdmissionsResponse {
  return {
    ...payload,
    universities: (payload.universities ?? []).map((university) => ({
      ...university,
      resources: university.resources ?? [],
    })),
    notices: (payload.notices ?? []).map((notice) => ({
      ...notice,
      designated_works: notice.designated_works ?? [],
      essay_questions: notice.essay_questions ?? [],
      stages: notice.stages ?? [],
      practical_items: notice.practical_items ?? [],
      results: notice.results ?? [],
    })),
  };
}

/** 자료 출처. 학원 홍보를 대학 공식 자료와 같은 무게로 보여주면 안 된다. */
export const SOURCE_LABEL: Record<string, string> = {
  official: '대학 공식',
  school: '고등학교',
  academy: '입시학원',
  personal: '개인',
};

/** 실기 종목. 웹과 같은 이름·같은 순서를 쓴다. */
export const PRACTICAL_LABEL: Record<string, string> = {
  free_acting: '자유연기',
  assigned_acting: '지정연기',
  improv: '즉흥연기',
  song: '노래',
  dance: '무용',
  movement: '신체표현',
  special: '특기',
  interview: '면접',
  essay: '작문',
  audition_etc: '기타',
};

export const DISCIPLINE_LABEL: Record<string, string> = {
  acting: '연기',
  musical: '뮤지컬',
};

export const TYPE_LABEL: Record<string, string> = {
  univ: '4년제',
  college: '전문대',
};

/** 반영비율 막대 순서. 실기가 먼저 와야 연기 지망생이 바로 읽는다. */
export const WEIGHT_FIELDS: { key: keyof AdmissionWeights; label: string }[] = [
  { key: 'practical', label: '실기' },
  { key: 'transcript', label: '학생부' },
  { key: 'csat', label: '수능' },
  { key: 'interview', label: '면접' },
  { key: 'portfolio', label: '서류' },
  { key: 'other', label: '기타' },
];

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
  if (start && end && start !== end) return `${start} ~ ${end}`;
  return start ?? end ?? null;
}

// ---- 필터 ----
// 웹의 AdmissionFilters와 축·의미가 같아야 한다. 한쪽만 고치면 두 화면이 다른
// 개수를 보여준다.

export type AdmissionFilters = {
  query: string;
  openOnly: boolean;
  regions: string[];
  tracks: string[];
  disciplines: string[];
  practicals: string[];
  types: string[];
  noCsatOnly: boolean;
};

export const EMPTY_FILTERS: AdmissionFilters = {
  query: '',
  openOnly: false,
  regions: [],
  tracks: [],
  disciplines: [],
  practicals: [],
  types: [],
  noCsatOnly: false,
};

/**
 * 수능 최저학력기준이 **없다고 확인된** 전형인지.
 *
 * csat_minimum 이 비어 있는 건 "없다"가 아니라 "아직 확인하지 못했다"는 뜻이다.
 * 빈 값을 없음으로 세면 확인도 안 한 전형을 "수능 안 봐도 돼요"라고 단정하게 된다.
 * 웹과 같은 규칙이다.
 */
export function hasNoCsatMinimum(notice: AdmissionNotice): boolean {
  const value = notice.csat_minimum?.trim();
  if (!value) return false;
  return /^(없음|미적용|해당\s*없음|없습니다)/.test(value);
}

/** "경기 용인" → "경기". 공백만 든 값이 빈 문자열 칩으로 올라오지 않게 한다. */
export function broadRegion(region?: string | null): string | null {
  return region?.trim().split(/\s+/)[0] || null;
}

export function noticeMatches(
  notice: AdmissionNotice,
  filters: AdmissionFilters,
  today?: string | null,
): boolean {
  if (filters.openOnly && today && !isOpen(notice, today)) return false;
  if (filters.tracks.length > 0 && !filters.tracks.includes(notice.track ?? '')) return false;
  if (filters.disciplines.length > 0 && !filters.disciplines.includes(notice.discipline ?? ''))
    return false;
  if (filters.noCsatOnly && !hasNoCsatMinimum(notice)) return false;
  if (filters.practicals.length > 0) {
    const categories = new Set((notice.practical_items ?? []).map((item) => item.category));
    if (!filters.practicals.some((wanted) => categories.has(wanted))) return false;
  }
  return true;
}

export function universityMatches(
  university: AdmissionUniversity,
  filters: AdmissionFilters,
): boolean {
  if (filters.regions.length > 0) {
    const broad = broadRegion(university.region);
    if (!broad || !filters.regions.includes(broad)) return false;
  }
  if (filters.types.length > 0 && !filters.types.includes(university.type ?? '')) return false;
  return true;
}

/**
 * 목록에 그릴 대학을 고른다. 필터를 아무것도 안 켰을 때는 공고가 없는 대학도 남긴다 —
 * 입학처 링크만이라도 보여주는 편이 "그 대학은 연기를 안 뽑는다"고 오해하게 두는 것보다 낫다.
 */
export function filterGroups(
  groups: UniversityGroup[],
  filters: AdmissionFilters,
  today?: string | null,
): UniversityGroup[] {
  const noticeFilterOn =
    filters.openOnly ||
    filters.noCsatOnly ||
    filters.tracks.length > 0 ||
    filters.disciplines.length > 0 ||
    filters.practicals.length > 0;

  const result: UniversityGroup[] = [];
  for (const group of groups) {
    if (!universityMatches(group.university, filters)) continue;
    const notices = noticeFilterOn
      ? group.notices.filter((notice) => noticeMatches(notice, filters, today))
      : group.notices;
    if (!matchesQuery({ university: group.university, notices }, filters.query)) continue;
    if (noticeFilterOn && notices.length === 0) continue;
    result.push({ university: group.university, notices });
  }
  return result;
}

export function activeFilterCount(filters: AdmissionFilters): number {
  return (
    filters.regions.length +
    filters.tracks.length +
    filters.disciplines.length +
    filters.practicals.length +
    filters.types.length +
    (filters.openOnly ? 1 : 0) +
    (filters.noCsatOnly ? 1 : 0)
  );
}

/** 데이터에 실제로 있는 값만 필터 선택지로 낸다. 0건만 내는 칩을 없앤다. */
export function availableFacets(payload: AdmissionsResponse) {
  const regions = new Set<string>();
  const types = new Set<string>();
  const tracks = new Set<string>();
  const disciplines = new Set<string>();
  const practicals = new Set<string>();

  for (const university of payload.universities) {
    const broad = broadRegion(university.region);
    if (broad) regions.add(broad);
    if (university.type) types.add(university.type);
  }
  for (const notice of payload.notices) {
    if (notice.track) tracks.add(notice.track);
    if (notice.discipline) disciplines.add(notice.discipline);
    for (const item of notice.practical_items ?? []) practicals.add(item.category);
  }

  // 실기 종목은 입력 순서가 아니라 PRACTICAL_LABEL 순서로. 대학을 추가할 때마다
  // 칩 순서가 바뀌면 안 된다.
  const order = Object.keys(PRACTICAL_LABEL);
  return {
    regions: [...regions].sort(),
    types: [...types].sort(),
    tracks: [...tracks].sort(),
    disciplines: [...disciplines].sort(),
    practicals: [...practicals].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
  };
}

/** 반영비율을 막대로 그릴 수 있게 편다. 0%는 그려도 보이지 않으므로 뺀다. */
export function weightBars(
  weights?: AdmissionWeights | null,
): { key: string; label: string; value: number }[] {
  if (!weights) return [];
  const bars: { key: string; label: string; value: number }[] = [];
  for (const { key, label } of WEIGHT_FIELDS) {
    const value = weights[key];
    if (typeof value === 'number' && value > 0) bars.push({ key, label, value });
  }
  return bars;
}

/** 120 → "2분", 90 → "1분 30초". 원문이 "2분 이내"인데 "120초"로 보이면 어색하다. */
export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
}
