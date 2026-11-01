import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { DonePage } from "@/features/reading/pages/done-page";

// 리딩 완료. 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 완료");

export default function Page() {
  return <DonePage />;
}
