import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { InputPage } from "@/features/reading/pages/input-page";

// 대본을 넣고 쓰는 도구 화면이라 색인 대상이 아니다(tests/seo-noindex-guard).
// 로그인 없이 열린다 — 배역 나누기는 기기에서 하고, 저장은 게스트 계정에 한다(reading.script, ADR-031).
export const metadata = buildNoindexMetadata("상대역 리딩");

export default function Page() {
  return <InputPage />;
}
