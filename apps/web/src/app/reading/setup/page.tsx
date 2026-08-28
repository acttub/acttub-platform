import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { SetupPage } from "@/features/reading/pages/setup-page";

// 배역 정하기. 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 배역 정하기");

export default function Page() {
  return <SetupPage />;
}
