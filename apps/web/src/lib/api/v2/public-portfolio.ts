import { apiFetch } from "./client";
import type { components } from "../v2-schema";

// GET /v2/public/portfolios/{slug} 의 응답. 성별은 저장 값이 "선택 안 함"이면 null 이고,
// 사진의 url 은 서버에 저장소가 설정돼 있지 않으면 null 이다(CONTRACT §6-1).
export type PublicPortfolioCredit = components["schemas"]["PublicPortfolioCredit"];
export type PublicPortfolio = components["schemas"]["PublicPortfolio"];

/**
 * 배우가 공유 링크를 켠 포트폴리오. 로그인 없이 부르며 토큰을 싣지 않는다 — 게스트가 있든
 * 없든 같고, 이 조회로 게스트가 생기지 않는다. 브라우저가 직접 부르므로 서버의 IP 별
 * 조회 제한이 보는 사람마다 따로 걸린다(결정 I-8).
 */
export async function getPublicPortfolio(
  slug: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicPortfolio> {
  const { data } = await apiFetch<PublicPortfolio>(
    // slug 가 URL 에 안전한 글자만이라고 가정하지 않는다.
    `/v2/public/portfolios/${encodeURIComponent(slug)}`,
    { method: "GET", auth: false, signal: options.signal },
  );
  return data;
}
