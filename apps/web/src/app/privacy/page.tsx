import { PrivacyPolicyPage } from "@/features/consent/privacy-policy-page";
import { buildPrivacyMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildPrivacyMetadata();

export default function PrivacyPage() {
  return <PrivacyPolicyPage />;
}
