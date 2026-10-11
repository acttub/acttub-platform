import { AuditionsPage } from "@/features/auditions/auditions-page";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 외부 출처에서 모은 공고라 검색엔진에 싣지 않는다(ADR-034: 운영 공개 전 법률 확인이 남아 있다).
// sitemap·llms.txt 에도 넣지 않는다(tests/seo-noindex-guard, tests/auditions).
export const metadata = buildNoindexMetadata("오디션 공고");

export default function Page() {
  return <AuditionsPage />;
}
