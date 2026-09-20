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
