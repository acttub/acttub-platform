import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { ScriptDetailPage } from "@/features/reading/pages/script-detail-page";

// 대본 상세(웹의 R00.5 대응). /reading/scripts/<id> 를 rewrite 로 이 껍데기에 보내고 브라우저가 id 를
// 읽는다(next.config). 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 대본 상세");

export default function Page() {
  return <ScriptDetailPage />;
}
