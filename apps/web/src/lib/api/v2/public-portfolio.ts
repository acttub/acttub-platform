import { apiFetch } from "./client";

// GET /v2/public/portfolios/{slug} 의 응답. api 갈래가 아직 이 엔드포인트를 내지 않아 생성
// 타입(v2-schema.d.ts)에 없다 — 통합 작업(I1)이 생성 타입으로 바꾼다.
export type PublicPortfolioCredit = {
  title: string;
  role: string;
  year: number;
  kind: "film" | "drama" | "play" | "musical" | "ad" | "other";
};

export type PublicPortfolio = {
  name: string;
  photo_url: string | null;
  /** 저장 값이 "선택 안 함"이면 서버가 null 로 준다. 그때는 성별 칸을 뺀다. */
  gender: "female" | "male" | null;
  age: number;
  intro: string | null;
  credits: PublicPortfolioCredit[];
  photos: { url: string }[];
};

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
