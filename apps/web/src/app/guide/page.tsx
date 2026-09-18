import { GUIDES } from "@/features/keyword-pages/content/guide/index";
import { GuideIndexView } from "@/features/keyword-pages/guide-index-view";
import {
  buildBreadcrumbJsonLd,
  buildGuideItemListJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildGuideIndexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildGuideIndexMetadata();

export default function GuideIndexPage() {
  const jsonLdValues = [
    buildBreadcrumbJsonLd({ path: "/guide", eyebrow: "연기 연습 가이드" }),
    buildGuideItemListJsonLd(GUIDES),
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
      <GuideIndexView guides={GUIDES} />
    </>
  );
}
