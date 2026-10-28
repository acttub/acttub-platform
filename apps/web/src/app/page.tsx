import LandingPageView from "./landing-page-view";
import { buildLandingMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildLandingMetadata();

// 프록시(src/proxy.ts)가 `/` 를 안별 페이지로 다시 쓴다. 프록시를 못 거친 요청은 기존 랜딩(A)이다.
export default function LandingPage() {
  return <LandingPageView variant="a" />;
}
