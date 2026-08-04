import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type AdmissionsResponse = components["schemas"]["AdmissionsResponse"];
export type AdmissionUniversity = components["schemas"]["AdmissionUniversity"];
export type AdmissionNotice = components["schemas"]["AdmissionNotice"];
export type AdmissionResource = components["schemas"]["AdmissionResource"];
export type AdmissionStage = components["schemas"]["AdmissionStage"];
export type AdmissionWeights = components["schemas"]["AdmissionWeights"];
export type AdmissionPracticalItem =
  components["schemas"]["AdmissionPracticalItem"];

/** 자료 출처. 학원 홍보를 대학 공식 영상과 같은 무게로 보여주면 안 된다. */
export const SOURCE_LABEL: Record<string, string> = {
  official: "대학 공식",
  school: "고등학교",
  academy: "입시학원",
  personal: "개인",
};

/** 실기 종목. 필터 칩과 상세 화면이 같은 이름을 써야 헷갈리지 않는다. */
export const PRACTICAL_LABEL: Record<string, string> = {
  free_acting: "자유연기",
  assigned_acting: "지정연기",
  improv: "즉흥연기",
  song: "노래",
  dance: "무용",
  movement: "신체표현",
  special: "특기",
  interview: "면접",
  essay: "작문",
  audition_etc: "기타",
};

/** 반영비율 막대에 쓰는 순서·이름. 실기가 먼저 와야 연기 지망생이 바로 읽는다. */
export const WEIGHT_FIELDS = [
  { key: "practical", label: "실기" },
  { key: "transcript", label: "학생부" },
  { key: "csat", label: "수능" },
  { key: "interview", label: "면접" },
  { key: "portfolio", label: "서류" },
  { key: "other", label: "기타" },
] as const;

export const DISCIPLINE_LABEL: Record<string, string> = {
  acting: "연기",
  musical: "뮤지컬",
};

/** 검색 상자에 친 말로 대학·학과를 거른다. 비어 있으면 전부 남긴다. */
export function matchesQuery(
  university: AdmissionUniversity,
  notices: AdmissionNotice[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    university.name,
    university.region ?? "",
    university.campus ?? "",
    ...notices.map((n) => `${n.department ?? ""} ${n.screening ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * 목록 필터. 값이 비어 있는 축은 거르지 않는다 — 아직 확인하지 못한 대학이
 * 필터를 켰다는 이유만으로 사라지면, 없는 것과 모르는 것을 구분할 수 없다.
 */
export type AdmissionFilters = {
  query: string;
  openOnly: boolean;
  /** "서울" | "경기" | "인천" 같은 광역 단위. 빈 배열이면 전체. */
  regions: string[];
  /** "수시" | "정시" */
  tracks: string[];
  /** "acting" | "musical" */
  disciplines: string[];
  /** PRACTICAL_LABEL의 키. 고른 종목을 하나라도 보는 전형만. */
  practicals: string[];
  /** "univ" | "college" */
  types: string[];
  /** 수능 최저학력기준이 없는 전형만 */
  noCsatOnly: boolean;
};

export const EMPTY_FILTERS: AdmissionFilters = {
  query: "",
  openOnly: false,
  regions: [],
  tracks: [],
  disciplines: [],
  practicals: [],
  types: [],
  noCsatOnly: false,
};

/** "경기 용인" → "경기". 필터는 광역 단위로 묶어야 선택지가 열 개 안쪽이 된다. */
export function broadRegion(region?: string | null): string | null {
  // 공백만 든 값을 그대로 두면 빈 문자열이 필터 칩으로 올라온다.
  return region?.trim().split(/\s+/)[0] || null;
}

/** 공고 하나가 필터를 통과하는지. 대학 단위 조건(지역·설립형태)은 여기서 안 본다. */
export function noticeMatches(
  notice: AdmissionNotice,
  filters: AdmissionFilters,
  today?: string | null,
): boolean {
  if (filters.openOnly && today && !isOpen(notice, today)) return false;
  if (filters.tracks.length > 0 && !filters.tracks.includes(notice.track ?? ""))
    return false;
  if (
    filters.disciplines.length > 0 &&
    !filters.disciplines.includes(notice.discipline ?? "")
  )
    return false;
  if (filters.noCsatOnly && notice.csat_minimum) return false;
  if (filters.practicals.length > 0) {
    const categories = new Set(
      (notice.practical_items ?? []).map((item) => item.category),
    );
    if (!filters.practicals.some((wanted) => categories.has(wanted)))
      return false;
  }
  return true;
}

/** 대학 자체에 걸리는 조건. 공고가 하나도 없는 대학도 여기까지는 통과한다. */
export function universityMatches(
  university: AdmissionUniversity,
  filters: AdmissionFilters,
): boolean {
  if (filters.regions.length > 0) {
    const broad = broadRegion(university.region);
    if (!broad || !filters.regions.includes(broad)) return false;
  }
  if (filters.types.length > 0 && !filters.types.includes(university.type ?? ""))
    return false;
  return true;
}

/** 켜져 있는 필터 개수. 버튼에 숫자를 띄워 "왜 목록이 짧지"를 없앤다. */
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

/** 데이터에 실제로 있는 값만 필터 선택지로 낸다. 빈 결과만 내는 칩을 없앤다. */
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

  // 실기 종목은 PRACTICAL_LABEL 순서를 따른다. Set 순서는 데이터 입력 순이라
  // 대학을 하나 추가할 때마다 칩 순서가 바뀌어 버린다.
  const order = Object.keys(PRACTICAL_LABEL);
  return {
    regions: [...regions].sort(),
    types: [...types].sort(),
    tracks: [...tracks].sort(),
    disciplines: [...disciplines].sort(),
    practicals: [...practicals].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    ),
  };
}

/** 반영비율을 막대로 그릴 수 있게 편다. 값이 하나도 없으면 빈 배열. */
export function weightBars(
  weights?: AdmissionWeights | null,
): { key: string; label: string; value: number }[] {
  if (!weights) return [];
  const bars: { key: string; label: string; value: number }[] = [];
  for (const { key, label } of WEIGHT_FIELDS) {
    const value = weights[key];
    // 0%인 항목(1단계 성적 미반영 등)은 막대로 그려도 보이지 않는다.
    if (typeof value === "number" && value > 0) bars.push({ key, label, value });
  }
  return bars;
}

// 공개 정보다. 가입 전에도 보여야 재방문 이유가 되므로 토큰을 붙이지 않는다.
export async function getAdmissions(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<AdmissionsResponse>("/v2/admissions", {
    auth: false,
    signal: options.signal,
  });
  return data;
}

/** 대학 하나만. 상세 화면이 쉰 곳치 공고를 통째로 받을 이유가 없다. */
export async function getUniversityAdmissions(
  universityId: string,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiFetch<AdmissionsResponse>(
    `/v2/admissions/${encodeURIComponent(universityId)}`,
    { auth: false, signal: options.signal },
  );
  return data;
}

/**
 * 공고를 대학별로 묶는다. 공고가 없는 대학도 링크는 보여준다.
 *
 * 접수가 빠른 대학부터 세운다 — 입시생에게 가장 급한 정보가 마감일이라서다.
 * 이미 끝난 전형과 날짜를 확인하지 못한 대학은 뒤로 보낸다. `today`를 주지 않으면
 * 마감 여부를 판단하지 않고 날짜순으로만 세운다.
 */
export function groupByUniversity(
  payload: AdmissionsResponse,
  today?: string | null,
) {
  return payload.universities
    .map((university) => ({
      university,
      notices: payload.notices
        .filter((notice) => notice.university_id === university.id)
        .sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today))),
    }))
    .sort((a, b) =>
      groupKey(a.notices, today).localeCompare(groupKey(b.notices, today)),
    );
}

export type AdmissionGroup = {
  university: AdmissionUniversity;
  notices: AdmissionNotice[];
};

/**
 * 목록에 실제로 그릴 대학을 고른다.
 *
 * 공고 단위 필터를 켜면 통과한 공고만 남기고, 하나도 안 남은 대학은 목록에서 뺀다.
 * 다만 필터를 아무것도 안 켰을 때는 공고가 없는 대학도 남긴다 — 입학처 링크만이라도
 * 보여주는 편이 "그 대학은 연기를 안 뽑는다"고 오해하게 두는 것보다 낫다.
 */
export function filterGroups(
  groups: AdmissionGroup[],
  filters: AdmissionFilters,
  today?: string | null,
): AdmissionGroup[] {
  const noticeFilterOn =
    filters.openOnly ||
    filters.noCsatOnly ||
    filters.tracks.length > 0 ||
    filters.disciplines.length > 0 ||
    filters.practicals.length > 0;

  const result: AdmissionGroup[] = [];
  for (const group of groups) {
    if (!universityMatches(group.university, filters)) continue;

    const notices = noticeFilterOn
      ? group.notices.filter((notice) => noticeMatches(notice, filters, today))
      : group.notices;

    if (!matchesQuery(group.university, notices, filters.query)) continue;
    if (noticeFilterOn && notices.length === 0) continue;
    result.push({ university: group.university, notices });
  }
  return result;
}

const NO_DATE = "8:9999-99-99";

/**
 * 접수 중·예정 → 날짜 미확인 → 이미 끝난 전형 순. 앞자리 숫자가 그 세 뭉치를 가른다.
 */
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
    (earliest, notice) =>
      sortKey(notice, today) < earliest ? sortKey(notice, today) : earliest,
    sortKey(notices[0], today),
  );
}

/**
 * 접수 시작까지 남은 날. 이미 시작했으면 마감까지 남은 날을 음수 아닌 값으로 준다.
 * 날짜가 없거나 이미 끝났으면 null — 화면에서 배지를 숨긴다.
 */
export function countdown(
  notice: AdmissionNotice,
  today: string,
): { label: string; days: number } | null {
  const days = (target: string) =>
    Math.round(
      (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    );

  if (notice.apply_start && notice.apply_start > today) {
    return { label: "접수 시작", days: days(notice.apply_start) };
  }
  if (notice.apply_end && notice.apply_end >= today) {
    return { label: "접수 마감", days: days(notice.apply_end) };
  }
  return null;
}

/** 원서접수가 끝나지 않은 것만. 날짜가 비어 있으면 판단하지 않고 남긴다. */
export function isOpen(notice: AdmissionNotice, today: string): boolean {
  if (!notice.apply_end) return true;
  return notice.apply_end >= today;
}
