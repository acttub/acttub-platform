import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  findGuide,
  GUIDES,
  guideSlug,
} from "@/features/keyword-pages/content/guide/index";
import { KeywordPageView } from "@/features/keyword-pages/keyword-page-view";
import {
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildKeywordArticleJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildKeywordPageMetadata } from "@/lib/seo/site-metadata";

type GuidePageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GUIDES.map((content) => ({ slug: guideSlug(content) }));
}

export async function generateMetadata(
  { params }: GuidePageProps,
): Promise<Metadata> {
  const content = findGuide((await params).slug);
  if (!content) notFound();
  return buildKeywordPageMetadata(content);
}

export default async function GuidePage({ params }: GuidePageProps) {
  const content = findGuide((await params).slug);
  if (!content) notFound();

  const jsonLdValues = [
    buildKeywordArticleJsonLd(content),
    buildFaqPageJsonLd(content),
    buildBreadcrumbJsonLd(content, undefined, {
      path: "/guide",
      name: "연기 연습 가이드",
    }),
    buildOrganizationJsonLd(),
  ];

  return (
    <>
      <JsonLd values={jsonLdValues} />
      <KeywordPageView content={content} />
    </>
  );
}
