import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { ScriptPage } from "@/features/reading/pages/script-page";

// 대본 확인(폰). 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 대본 확인");

export default function Page() {
  return <ScriptPage />;
}
