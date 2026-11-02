import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { RunPage } from "@/features/reading/pages/run-page";

// 리딩 실행(읽어주기 · 암기 대조). 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 리딩");

export default function Page() {
  return <RunPage />;
}
