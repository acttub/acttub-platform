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

/** 공고를 대학별로 묶는다. 공고가 없는 대학도 링크는 보여준다. */
export function groupByUniversity(payload: AdmissionsResponse) {
  return payload.universities.map((university) => ({
    university,
    notices: payload.notices.filter(
      (notice) => notice.university_id === university.id,
    ),
  }));
}

/** 원서접수가 끝나지 않은 것만. 날짜가 비어 있으면 판단하지 않고 남긴다. */
export function isOpen(notice: AdmissionNotice, today: string): boolean {
  if (!notice.apply_end) return true;
  return notice.apply_end >= today;
}
