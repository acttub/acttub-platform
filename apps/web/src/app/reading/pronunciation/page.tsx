import { Suspense } from "react";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { PronunciationPage } from "@/features/reading/pages/pronunciation-page";
import { PronunciationSkeleton } from "@/features/reading/screens/PronunciationReportScreen";

// 리딩 발음 보고서(SOMA-606). 회원 전용이라 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("상대역 리딩 · 발음 보고서");

export default function Page() {
  return (
    <Suspense fallback={<PronunciationSkeleton />}>
      <PronunciationPage />
    </Suspense>
  );
}
