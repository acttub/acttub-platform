import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeAdmissions,
  type AdmissionsResponse,
} from "@/lib/api/v2/admissions";

// 이 파일은 서버(빌드) 전용이다. 클라이언트 컴포넌트에서 import하면 안 된다.
const NOTICES_PATH = join(
  process.cwd(),
  "..",
  "api",
  "src",
  "main",
  "resources",
  "admissions",
  "notices.json",
);

export function loadAdmissionsStatic(): AdmissionsResponse {
  const payload = JSON.parse(
    readFileSync(NOTICES_PATH, "utf-8"),
  ) as AdmissionsResponse;
  return normalizeAdmissions(payload);
}

/**
 * 목록 화면(`/admissions`)에 넘길 만큼만 남긴다.
 *
 * 목록은 클라이언트 컴포넌트라 `initial`로 넘긴 값이 통째로 HTML 안에 JSON으로 실린다.
 * 원본 전량(약 790KB)을 넘겼더니 HTML이 870KB인데 보이는 글은 3천 자뿐이라, 구글이
 * 읽어 가고도 색인을 거절했다(2026-09-24 "크롤링됨 - 현재 색인 안 됨").
 *
 * 남기는 것은 목록·필터·정렬·카드가 실제로 읽는 값뿐이다 — 대학 이름·지역·캠퍼스·설립형태,
 * 공고의 학과·전형·계열·접수 기간·수능 최저, 실기 종목(category). 팁·결과·일정·과제 설명
 * 같은 상세 전용 값은 대학 상세 페이지가 자기 몫만 싣는다. 클라이언트가 API 응답을 받으면
 * 이 값은 전량으로 바뀌므로 목록 동작은 달라지지 않는다(`tests/admissions-list-payload`).
 */
export function toAdmissionsListPayload(
  payload: AdmissionsResponse,
): AdmissionsResponse {
  return {
    updated_at: payload.updated_at,
    disclaimer: payload.disclaimer,
    universities: payload.universities.map((university) => ({
      id: university.id,
      name: university.name,
      // 스키마 필수라 빈 값으로 둔다. 목록은 이 값을 읽지 않는다.
      admission_url: "",
      ...pickPresent(university, ["region", "campus", "type"] as const),
      // 카드가 "영상 N"만 그린다. 개수를 지키려고 자리만 남기고 내용은 비운다.
      resources: university.resources.map(({ kind }) => ({
        kind,
        title: "",
        url: "",
        publisher: "",
        source_type: "",
      })),
      tips: [],
    })),
    notices: payload.notices.map((notice) => ({
      id: notice.id,
      university_id: notice.university_id,
      ...pickPresent(notice, [
        "department",
        "discipline",
        "admission_year",
        "track",
        "screening",
        "apply_start",
        "apply_end",
        "practical_date",
        "csat_minimum",
      ] as const),
      // 실기 종목 필터와 요약 줄은 category만 본다.
      practical_items: notice.practical_items.map(({ category }) => ({ category })),
      designated_works: [],
      essay_questions: [],
      stages: [],
      results: [],
    })),
  };
}

/** 값이 있는 키만 옮긴다. 없는 키를 undefined로 두면 HTML에 실리는 JSON이 늘어난다. */
function pickPresent<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) picked[key] = value;
  }
  return picked;
}

export function loadUniversityAdmissionsStatic(
  id: string,
): AdmissionsResponse | null {
  const payload = loadAdmissionsStatic();
  const universities = payload.universities.filter(
    (university) => university.id === id,
  );
  if (universities.length === 0) return null;

  return {
    ...payload,
    universities,
    notices: payload.notices.filter((notice) => notice.university_id === id),
  };
}
