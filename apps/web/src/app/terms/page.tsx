import { ConsentDocumentsPage } from "@/features/consent/consent-documents-page";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("안전 약속");

export default function TermsPage() {
  return <ConsentDocumentsPage />;
}
