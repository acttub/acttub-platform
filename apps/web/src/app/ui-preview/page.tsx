import { UiPreview } from "@/features/ui-preview/ui-preview";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("화면 미리보기");

// 화면만 보는 통로. 운영에서는 안내 문구만 뜬다 — 판단은 UiPreview 안에 있다.
export default function UiPreviewPage() {
  return <UiPreview />;
}
