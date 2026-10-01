import { ACTING_COACHING } from "@/features/keyword-pages/content/acting-coaching";
import { KeywordPageView } from "@/features/keyword-pages/keyword-page-view";
import {
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildKeywordArticleJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildKeywordPageMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildKeywordPageMetadata(ACTING_COACHING);

export default function ActingCoachingPage() {
  const jsonLdValues = [
    buildKeywordArticleJsonLd(ACTING_COACHING),
    buildFaqPageJsonLd(ACTING_COACHING),
    buildBreadcrumbJsonLd(ACTING_COACHING),
    buildOrganizationJsonLd(),
  ];

  return (
    <>
      <JsonLd values={jsonLdValues} />
      <KeywordPageView content={ACTING_COACHING} />
    </>
  );
}
