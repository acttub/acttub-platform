import { PublicPortfolioPage } from "@/features/portfolio/public-portfolio-page";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 포트폴리오 공개 페이지의 껍데기(결정 I-8). 실제 주소는 /p/<slug> 이고 next.config.ts 의
// rewrites 가 이 페이지 하나를 서빙한다 — slug 는 빌드 때 알 수 없고, 브라우저가 경로에서 읽는다.
//
// 검색 엔진에 노출하지 않는다(noindex·nofollow). 제목과 OG 는 서비스 공통 것만 쓴다 — 사람마다
// 제목·이미지를 넣으면 메신저 미리보기에 이름과 사진이 샌다. sitemap·robots 에도 싣지 않는다.
export const metadata = buildNoindexMetadata("포트폴리오");

export default function PublicPortfolioRoute() {
  return <PublicPortfolioPage />;
}
