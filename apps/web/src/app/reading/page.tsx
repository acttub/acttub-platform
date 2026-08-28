import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { InputPage } from "@/features/reading/pages/input-page";

// 대본을 넣고 쓰는 도구 화면이라 색인 대상이 아니다(tests/seo-noindex-guard).
// 로그인 없이도 열린다 — 대본은 기기 안에서만 다루고 서버로 가지 않는다(SOMA-447).
export const metadata = buildNoindexMetadata("상대역 리딩");

export default function Page() {
  return <InputPage />;
}
