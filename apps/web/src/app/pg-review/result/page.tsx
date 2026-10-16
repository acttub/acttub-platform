import { PgReviewResultApp } from "@/features/pg-review/pg-review-result";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 테스트 결제 결과 (심사용)");

export default function PgReviewResultPage() {
  return <PgReviewResultApp />;
}
