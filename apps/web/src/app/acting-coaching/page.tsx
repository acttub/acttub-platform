import { ACTING_COACHING } from "@/features/keyword-pages/content/acting-coaching";
import { KeywordPageView } from "@/features/keyword-pages/keyword-page-view";
import {
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildKeywordArticleJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
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
      {jsonLdValues.map((value) => (
        <script
          key={value["@id"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(value) }}
        />
      ))}
      <KeywordPageView content={ACTING_COACHING} />
    </>
  );
}
