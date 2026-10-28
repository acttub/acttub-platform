import { notFound } from "next/navigation";

import LandingPageView from "@/app/landing-page-view";
import { isLandingVariant, LANDING_VARIANTS } from "@/lib/landing-variant";
import { buildLandingMetadata } from "@/lib/seo/site-metadata";

// `/` 요청을 src/proxy.ts 가 이 페이지로 다시 쓴다(주소는 `/` 그대로). SOMA-918 첫 화면 A/B.
export const metadata = buildLandingMetadata();
export const dynamicParams = false;

export function generateStaticParams() {
  return LANDING_VARIANTS.map((variant) => ({ variant }));
}

export default async function LandingVariantPage({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!isLandingVariant(variant)) notFound();
  return <LandingPageView variant={variant} />;
}
