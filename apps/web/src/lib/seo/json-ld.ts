import { APP_STORE_URL, GOOGLE_PLAY_URL } from "../app-download/store-links";
import type { KeywordPageContent } from "@/features/keyword-pages/types";
import { resolveSiteUrl, SITE_DESCRIPTION } from "./site-metadata";

function resolveSchemaUrls(siteUrl?: string) {
  const baseUrl = resolveSiteUrl(siteUrl);
  return {
    homepageUrl: `${baseUrl}/`,
    organizationId: `${baseUrl}/#org`,
  };
}

type KeywordJsonLdContent = Pick<
  KeywordPageContent,
  "path" | "description" | "eyebrow" | "h1" | "updatedAt" | "faq"
>;

export function buildFaqPageJsonLd(
  content: Pick<KeywordPageContent, "path" | "faq">,
  siteUrl?: string,
) {
  const baseUrl = resolveSiteUrl(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${baseUrl}${content.path}#faq`,
    mainEntity: content.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function buildKeywordArticleJsonLd(
  content: KeywordJsonLdContent,
  siteUrl?: string,
) {
  const baseUrl = resolveSiteUrl(siteUrl);
  const { organizationId } = resolveSchemaUrls(siteUrl);
  const pageUrl = `${baseUrl}${content.path}`;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${pageUrl}#article`,
    headline: content.h1,
    description: content.description,
    inLanguage: "ko",
    dateModified: content.updatedAt,
    mainEntityOfPage: pageUrl,
    author: { "@id": organizationId },
    publisher: { "@id": organizationId },
  };
}

export function buildBreadcrumbJsonLd(
  content: Pick<KeywordPageContent, "path" | "eyebrow">,
  siteUrl?: string,
  intermediate?: { path: string; name: string },
) {
  const baseUrl = resolveSiteUrl(siteUrl);
  const pageUrl = `${baseUrl}${content.path}`;

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: `${baseUrl}/` },
      ...(intermediate
        ? [{
            "@type": "ListItem",
            position: 2,
            name: intermediate.name,
            item: `${baseUrl}${intermediate.path}`,
          }]
        : []),
      {
        "@type": "ListItem",
        position: intermediate ? 3 : 2,
        name: content.eyebrow,
        item: pageUrl,
      },
    ],
  };
}

export function buildGuideItemListJsonLd(
  guides: readonly Pick<KeywordPageContent, "path" | "h1">[],
  siteUrl?: string,
) {
  const baseUrl = resolveSiteUrl(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${baseUrl}/guide#list`,
    itemListElement: guides.map((guide, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${baseUrl}${guide.path}`,
      name: guide.h1,
    })),
  };
}

export function buildOrganizationJsonLd(siteUrl?: string) {
  const { homepageUrl, organizationId } = resolveSchemaUrls(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId,
    name: "Acttub",
    url: homepageUrl,
    // 스토어 두 곳을 sameAs 로 잇는다 — 검색엔진이 웹과 앱을 같은 서비스로 묶는 근거다.
    sameAs: [
      "https://www.instagram.com/acttub_com/",
      APP_STORE_URL,
      GOOGLE_PLAY_URL,
    ],
    email: "acttub0527@gmail.com",
  };
}

export function buildWebSiteJsonLd(siteUrl?: string) {
  const { homepageUrl, organizationId } = resolveSchemaUrls(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${resolveSiteUrl(siteUrl)}/#website`,
    name: "Acttub",
    url: homepageUrl,
    inLanguage: "ko",
    publisher: { "@id": organizationId },
  };
}

const FREE_OFFER = {
  "@type": "Offer",
  price: "0",
  priceCurrency: "KRW",
} as const;

/**
 * 스토어에 올라간 앱 두 개. 웹앱(SoftwareApplication)과 따로 선언한다 — 셋은 받는 곳도
 * 도는 곳도 다르고, `installUrl`이 있어야 검색 결과에서 스토어로 바로 이어진다.
 */
export function buildMobileApplicationJsonLd(siteUrl?: string) {
  const baseUrl = resolveSiteUrl(siteUrl);
  const { organizationId } = resolveSchemaUrls(siteUrl);

  return (
    [
      { id: "ios", operatingSystem: "iOS", installUrl: APP_STORE_URL },
      { id: "android", operatingSystem: "Android", installUrl: GOOGLE_PLAY_URL },
    ] as const
  ).map((app) => ({
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": `${baseUrl}/#app-${app.id}`,
    name: "Acttub",
    url: `${baseUrl}/app`,
    description: SITE_DESCRIPTION,
    applicationCategory: "EducationalApplication",
    operatingSystem: app.operatingSystem,
    installUrl: app.installUrl,
    downloadUrl: app.installUrl,
    offers: FREE_OFFER,
    publisher: { "@id": organizationId },
  }));
}

export function buildSoftwareApplicationJsonLd(siteUrl?: string) {
  const { homepageUrl, organizationId } = resolveSchemaUrls(siteUrl);

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${resolveSiteUrl(siteUrl)}/#app`,
    name: "Acttub",
    url: homepageUrl,
    description: SITE_DESCRIPTION,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    offers: FREE_OFFER,
    publisher: { "@id": organizationId },
  };
}
