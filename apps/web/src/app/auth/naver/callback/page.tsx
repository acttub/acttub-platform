import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import NaverAppReturn from "./naver-app-return";

// 앱의 네이버 로그인이 잠깐 거쳐 가는 중간 페이지라 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("네이버 로그인");

/** `/auth/naver/callback` — 네이버 콘솔에 등록하는 Callback URL. 받은 값을 앱(`actingapp://auth/naver`)으로 넘긴다. */
export default function NaverCallbackPage() {
  return <NaverAppReturn />;
}
