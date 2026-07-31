import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type AdmissionsResponse = components["schemas"]["AdmissionsResponse"];
export type AdmissionUniversity = components["schemas"]["AdmissionUniversity"];
export type AdmissionNotice = components["schemas"]["AdmissionNotice"];

// 공개 정보다. 가입 전에도 보여야 재방문 이유가 되므로 토큰을 붙이지 않는다.
export async function getAdmissions(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<AdmissionsResponse>("/v2/admissions", {
    auth: false,
    signal: options.signal,
  });
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
  return notices.reduce(
    (earliest, notice) =>
      sortKey(notice, today) < earliest ? sortKey(notice, today) : earliest,
    NO_DATE,
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
