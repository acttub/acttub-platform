import {
  groupTips,
  PRACTICAL_LABEL,
  type AdmissionGroup,
  type AdmissionNotice,
  type AdmissionTip,
  type AdmissionUniversity,
} from "@/lib/api/v2/admissions";

/**
 * 입시 정보를 학년도 단위로 다시 세우는 순수 함수들.
 *
 * 공고·입시결과·후기가 서로 다른 해의 것이 섞여 있다. 2027학년도 수시 요강 옆에 2026학년도
 * 정시 요강(올해 것이 아직 안 나와서 대신 넣은 것), 2025·2026학년도 입시결과, 해를 알 수
 * 없는 후기가 한 화면에 있으면 읽는 사람은 어느 숫자가 올해 것인지 모른다. 그래서 화면은
 * 항상 "몇 학년도의 무엇"인지 붙여서 보여준다.
 */

export type AdmissionResultRow = AdmissionNotice["results"][number];

const TRACK_ORDER = ["수시", "정시"];

export type YearSection = {
  year: number | null;
  /** 최신 학년도 요강이 아직 없어 지난 학년도 요강을 대신 보여주는 묶음 */
  standIn: boolean;
  notices: AdmissionNotice[];
};

/** 데이터에 있는 가장 최근 학년도. 공고가 없으면 null. */
export function latestAdmissionYear(notices: AdmissionNotice[]): number | null {
  const years = notices
    .map(({ admission_year }) => admission_year)
    .filter((year): year is number => typeof year === "number");
  return years.length > 0 ? Math.max(...years) : null;
}

/**
 * 공고를 학년도 내림차순으로 묶는다. 학년도를 모르는 공고는 맨 뒤.
 *
 * `latest`는 전체 데이터 기준 최신 학년도다. 한 대학만 보면 그 대학의 최신이 2026일 수
 * 있는데, 그건 "올해 요강이 아직 없다"는 뜻이라 대신 보여주는 공고로 표시해야 한다.
 */
export function splitByYear(
  notices: AdmissionNotice[],
  latest: number | null = latestAdmissionYear(notices),
): YearSection[] {
  const buckets = new Map<number | null, AdmissionNotice[]>();
  for (const notice of notices) {
    const year = typeof notice.admission_year === "number" ? notice.admission_year : null;
    const bucket = buckets.get(year);
    if (bucket) bucket.push(notice);
    else buckets.set(year, [notice]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a))
    .map(([year, items]) => ({
      year,
      standIn: year !== null && latest !== null && year < latest,
      notices: [...items].sort((a, b) => trackIndex(a.track) - trackIndex(b.track)),
    }));
}

function trackIndex(track?: string | null): number {
  const index = TRACK_ORDER.indexOf(track ?? "");
  return index === -1 ? TRACK_ORDER.length : index;
}

export type NoticeStage = { label: string; tone: "live" | "muted" };

/**
 * 오늘 기준으로 전형이 어디쯤인지. 접수 → 실기 → 발표 순서로 아는 날짜만 본다.
 *
 * 접수가 끝난 뒤의 상태를 모르면 "접수 마감"까지만 말한다 — 실기 날짜를 모르면서
 * "실기 진행 중"이라고 하면 거짓말이 된다. 오늘을 모르면(프리렌더) 아무 말도 안 한다.
 */
export function noticeStage(
  notice: AdmissionNotice,
  today: string | null,
): NoticeStage | null {
  if (!today) return null;
  const { apply_start, apply_end, practical_date, announce_date } = notice;
  const practicalEnd = notice.practical_date_end ?? practical_date;

  if (apply_start && today < apply_start) return { label: "접수 예정", tone: "live" };
  if (apply_end && today <= apply_end) return { label: "접수 중", tone: "live" };
  if (practical_date && today < practical_date) return { label: "실기 예정", tone: "live" };
  if (practical_date && practicalEnd && today <= practicalEnd) {
    return { label: "실기 진행 중", tone: "live" };
  }
  if (announce_date) {
    return today <= announce_date
      ? { label: "발표 예정", tone: "live" }
      : { label: "전형 종료", tone: "muted" };
  }
  if (apply_end || practical_date) return { label: "접수 마감", tone: "muted" };
  return null;
}

/** 결과가 있는 공고만, 각 공고의 결과를 학년도 내림차순으로. */
export function resultHistory(
  notices: AdmissionNotice[],
): { notice: AdmissionNotice; rows: AdmissionResultRow[] }[] {
  return notices
    .filter((notice) => notice.results.length > 0)
    .map((notice) => ({
      notice,
      rows: [...notice.results].sort((a, b) => b.year - a.year),
    }));
}

/** "82.91:1" → 82.91. "N:1" 꼴이 아니면 null — 지원자·모집 수를 나눠 만들지 않는다. */
export function competitionRatio(value?: string | null): number | null {
  const match = value?.match(/^\s*([\d.,]+)\s*:\s*1\s*$/);
  if (!match) return null;
  const ratio = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(ratio) ? ratio : null;
}

export type YearResultRow = {
  university: AdmissionUniversity;
  notice: AdmissionNotice;
  result: AdmissionResultRow;
};

/** 그 학년도 결과가 있는 공고를 경쟁률 높은 순으로. 경쟁률이 없는 줄은 뒤로. */
export function yearResultRows(groups: AdmissionGroup[], year: number): YearResultRow[] {
  const rows = groups.flatMap(({ university, notices }) =>
    notices.flatMap((notice) =>
      notice.results
        .filter((result) => result.year === year)
        .map((result) => ({ university, notice, result })),
    ),
  );
  return rows
    .map((row, index) => ({ row, index, ratio: competitionRatio(row.result.competition_rate) }))
    .sort((a, b) => {
      if (a.ratio === null && b.ratio === null) return a.index - b.index;
      if (a.ratio === null) return 1;
      if (b.ratio === null) return -1;
      return b.ratio - a.ratio || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** 결과가 있는 학년도 목록(내림차순). 목록 화면 탭이 이걸로 선다. */
export function resultYears(notices: AdmissionNotice[]): number[] {
  return [...new Set(notices.flatMap(({ results }) => results.map(({ year }) => year)))].sort(
    (a, b) => b - a,
  );
}

/** 후기를 응시 학년도별로 묶는다. 연도를 모르는 후기는 맨 뒤. */
export function tipsByYear(tips: AdmissionTip[]) {
  const buckets = new Map<number | null, AdmissionTip[]>();
  for (const tip of tips) {
    const year = typeof tip.year === "number" ? tip.year : null;
    const bucket = buckets.get(year);
    if (bucket) bucket.push(tip);
    else buckets.set(year, [tip]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a))
    .map(([year, items]) => ({
      year,
      label: year === null ? "응시 연도를 밝히지 않은 후기" : `${year}학년도 응시 후기`,
      groups: groupTips(items),
    }));
}

const DIGEST_RESULT_LIMIT = 2;

/**
 * 상세 화면 맨 위 "한눈에 보기". 데이터 필드로만 문장을 만든다 — 지어낸 말이 섞이면
 * 안 되는 화면이라 템플릿에 값을 끼우는 것 말고는 하지 않는다. 모르는 조각은 뺀다.
 */
export function universityDigest(
  notices: AdmissionNotice[],
  tips: AdmissionTip[],
  latest: number | null,
): string[] {
  if (notices.length === 0) return [];
  const lines: string[] = [];
  const sections = splitByYear(notices, latest);
  const current = sections.find(({ year, standIn }) => year !== null && !standIn);

  if (current) {
    const counts = TRACK_ORDER.map((track) => [
      track,
      current.notices.filter((notice) => notice.track === track).length,
    ] as const).filter(([, count]) => count > 0);
    if (counts.length > 0) {
      lines.push(
        `${current.year}학년도에는 ${counts
          .map(([track, count]) => `${track} ${count}개`)
          .join(", ")} 전형으로 뽑아요.`,
      );
    }
  }

  for (const section of sections.filter(({ standIn }) => standIn)) {
    const tracks = unique(section.notices.map(({ track }) => track ?? "").filter(Boolean));
    lines.push(
      `${tracks.length > 0 ? `${tracks.join("·")}는` : "일부 전형은"} ${latest}학년도 요강이 아직 나오지 않아 ${section.year}학년도 기준으로 적었어요.`,
    );
  }

  const practicals = unique(
    (current?.notices ?? notices).flatMap(({ practical_items }) =>
      practical_items.map(({ category }) => PRACTICAL_LABEL[category] ?? category),
    ),
  );
  if (practicals.length > 0) lines.push(`실기는 ${practicals.join("·")}를 봐요.`);

  const latestResultYear = resultYears(notices)[0];
  if (latestResultYear) {
    const measured = notices
      .flatMap((notice) =>
        notice.results
          .filter((result) => result.year === latestResultYear && result.competition_rate)
          .map((result) => ({ notice, result })),
      )
      .slice(0, DIGEST_RESULT_LIMIT);
    for (const { notice, result } of measured) {
      const name = [notice.department, notice.track].filter(Boolean).join(" ");
      lines.push(
        `${latestResultYear}학년도 ${name} 경쟁률은 ${result.competition_rate}이었어요.`,
      );
    }
  }

  if (tips.length > 0) {
    lines.push(`먼저 응시한 사람들의 후기 ${tips.length}건을 학년도별로 묶었어요.`);
  }
  return lines;
}

function unique(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
