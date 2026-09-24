import { ACTTUB_CLIENT } from "../../config/env";
import type { components } from "../v2-schema";

// GET /v2/public/entries/{id} 의 응답(challenge.share). 작성자의 이름·사진은 없다.
// character 는 챌린지에 배역이 없으면, poster_url 은 장면 이미지가 없으면 null 이다.
export type PublicEntry = components["schemas"]["PublicChallengeEntry"];

export type PublicEntryLookup =
  | { kind: "found"; entry: PublicEntry }
  | { kind: "not_found" }
  | { kind: "failed" };

/**
 * 웹 **서버**가 API 에 직접 묻는 주소. 브라우저의 조회는 same-origin 으로 rewrites 를 타지만, 서버
 * 렌더(메신저 미리보기)는 같은 rewrites 의 목적지(API_ORIGIN)로 곧장 간다. 이 값은 next.config.ts 의
 * `env` 로 빌드 때 서버 번들에 굳는다 — 런타임 이미지에는 API_ORIGIN 환경변수가 없다(apps/web/Dockerfile).
 * ⚠ 서버에서만 import 한다. 클라이언트 번들에 들어가면 내부 주소가 새긴다.
 */
export const SERVER_API_ORIGIN =
  process.env.ACTTUB_SERVER_API_ORIGIN ?? "http://127.0.0.1:8080";

/**
 * 공유 링크 미리보기용 참여작 조회. 로그인 없이 부르고 공용 클라이언트(apiFetch)를 쓰지 않는다 — 그쪽은
 * 브라우저의 토큰·게스트·동의 시트를 다루는데, 여기는 서버라 그중 어느 것도 없다.
 *
 * 방문자 주소(`X-Forwarded-For`)를 그대로 넘긴다. API 는 신뢰하는 프록시(web)가 붙인 이 헤더로 IP 별
 * 제한을 건다(CONTRACT §6-13). 넘기지 않으면 모든 방문자가 web 컨테이너 한 칸을 나눠 쓴다.
 */
export async function getPublicEntry(
  id: string,
  options: {
    origin?: string;
    forwardedFor?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<PublicEntryLookup> {
  const headers = new Headers({
    "X-Acttub-Client": ACTTUB_CLIENT,
    "Accept-Language": "ko",
  });
  if (options.forwardedFor) headers.set("X-Forwarded-For", options.forwardedFor);

  let response: Response;
  try {
    response = await fetch(
      `${options.origin ?? SERVER_API_ORIGIN}/v2/public/entries/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers,
        // 신고로 숨겨지거나 비공개로 바뀐 참여작이 캐시로 남아 미리보기에 뜨면 안 된다.
        cache: "no-store",
        signal: options.signal,
      },
    );
  } catch {
    return { kind: "failed" };
  }
  // 모양이 틀린 id(UUID 아님)는 422 다. 보는 사람에게는 없는 것과 같다.
  if (response.status === 404 || response.status === 422) return { kind: "not_found" };
  if (!response.ok) return { kind: "failed" };
  try {
    return { kind: "found", entry: (await response.json()) as PublicEntry };
  } catch {
    return { kind: "failed" };
  }
}
