import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 빌드 시점에 대학 id 목록을 읽는다.
 *
 * 정적 export라 `/admissions/[id]`는 빌드할 때 어떤 id가 있는지 알아야 한다.
 * 런타임에 API를 부를 수 없으므로 모노레포 안의 원본 파일을 직접 읽는다 —
 * `generate:v2-schema`가 `../api/spec/openapi.json`을 읽는 것과 같은 방식이다.
 *
 * 이 파일은 서버(빌드) 전용이다. 클라이언트 컴포넌트에서 import하면 안 된다.
 */
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

export function universityIds(): string[] {
  // 읽지 못하면 상세 페이지가 통째로 안 생긴다. 조용히 빈 배열을 주면
  // 목록의 모든 링크가 404가 되므로 빌드를 세운다.
  const raw = JSON.parse(readFileSync(NOTICES_PATH, "utf-8")) as {
    universities?: { id?: string }[];
  };
  const ids = (raw.universities ?? [])
    .map((university) => university.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) {
    throw new Error(`대학 id를 읽지 못했습니다: ${NOTICES_PATH}`);
  }
  return ids;
}
