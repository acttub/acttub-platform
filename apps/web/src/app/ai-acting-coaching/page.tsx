import { AI_ACTING_COACHING } from "@/features/keyword-pages/content/ai-acting-coaching";
import { KeywordPageView } from "@/features/keyword-pages/keyword-page-view";
import {
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildKeywordArticleJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildKeywordPageMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildKeywordPageMetadata(AI_ACTING_COACHING);

export default function AiActingCoachingPage() {
  const jsonLdValues = [
    buildKeywordArticleJsonLd(AI_ACTING_COACHING),
    buildFaqPageJsonLd(AI_ACTING_COACHING),
    buildBreadcrumbJsonLd(AI_ACTING_COACHING),
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
      <KeywordPageView content={AI_ACTING_COACHING} />
    </>
  );
}
