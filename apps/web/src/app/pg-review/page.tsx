import { PgReviewApp } from "@/features/pg-review/pg-review-app";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 테스트 결제 (심사용)");

export default function PgReviewPage() {
  return <PgReviewApp />;
}
