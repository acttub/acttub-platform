import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 참여작 공유 페이지는 검색 엔진에 싣지 않는다(challenge.share). page 의 generateMetadata 가 미리보기용
// 제목·OG 를 채우고, 색인 금지는 여기와 page 양쪽에 둔다 — tests/seo-noindex-guard 가 이 export 를 본다.
// sitemap·robots 에도 싣지 않는다.
export const metadata = buildNoindexMetadata("공유된 연기");

export default function EntryShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
