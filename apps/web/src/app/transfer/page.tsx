import { TransferCodePage } from "@/features/transfer/transfer-code-page";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 게스트 한 사람의 자료를 옮기는 화면이라 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("앱으로 옮기기");

export default function TransferPage() {
  return <TransferCodePage />;
}
