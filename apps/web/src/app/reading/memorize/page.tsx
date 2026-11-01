import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { MemorizePage } from "@/features/reading/pages/memorize-page";

// 암기 화면(R04·R04.1 대응). 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 암기");

export default function Page() {
  return <MemorizePage />;
}
