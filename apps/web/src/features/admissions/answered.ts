import type { AdmissionsResponse } from "@/lib/api/v2/admissions";
import type { Resource } from "@/lib/react/use-resource";

/**
 * 답이 온 그 순간의 오늘. 마감 D-day 와 "접수 중"인지가 이것을 기준으로 선다.
 *
 * 인자를 받는 까닭은 부르는 시각이 **응답이 온 시각**이어야 하기 때문이다 — 페이지를
 * 빌드 시점에 프리렌더하므로 렌더 중에 오늘을 읽으면 프리렌더된 HTML 과 어긋난다.
 * UTC 로 자르면 한국 오전에 하루가 밀린다.
 */
function localDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 답이 왔을 때만 본문과 그때의 오늘을 함께 꺼낸다. 둘은 **늘 같이 서고 같이 없다** —
 * 목록·대학 상세 두 화면이 그 관계를 같은 세 줄로 따로 적고 있었다.
 */
export function answeredAdmissions(resource: Resource<AdmissionsResponse>): {
  payload: AdmissionsResponse | null;
  today: string | null;
} {
  if (resource.state !== "ready") return { payload: null, today: null };
  return { payload: resource.data, today: localDate(resource.receivedAt) };
}
