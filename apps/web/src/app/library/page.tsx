import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { LibraryPage } from "@/features/library/library-page";

// 영상 보관함(practice.library). /library/<id> 는 rewrite 로 이 껍데기에 오고 브라우저가 id 를 읽는다.
// 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("영상 보관함");

export default function Page() {
  return <LibraryPage />;
}
