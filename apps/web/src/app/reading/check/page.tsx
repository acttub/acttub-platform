import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import MobileCheck from "@/features/reading/device-check";

// 이 기기에서 브라우저 음성 합성이 쓸 만한지 재 보는 검사 화면. 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 기기 검사");

export default function Page() {
  return <MobileCheck />;
}
