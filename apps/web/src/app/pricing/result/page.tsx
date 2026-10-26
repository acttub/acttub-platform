import { BillingResultApp } from "@/features/billing/billing-result";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 결제 결과");

export default function PricingResultPage() {
  return <BillingResultApp />;
}
