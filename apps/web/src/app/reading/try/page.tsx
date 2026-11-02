import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { TryPage } from "@/features/reading/pages/try-page";

// 광고·검색에서 곧장 들어오는 빠른 시작. 예시 대본을 불러와 리딩 화면으로 넘기는 중간 화면이라 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 해 보기");

export default function Page() {
  return <TryPage />;
}
