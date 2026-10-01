import { GUIDES } from "@/features/keyword-pages/content/guide/index";
import { GuideIndexView } from "@/features/keyword-pages/guide-index-view";
import {
  buildBreadcrumbJsonLd,
  buildGuideItemListJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
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
      <JsonLd values={jsonLdValues} />
      <GuideIndexView guides={GUIDES} />
    </>
  );
}
