import { APP_STORE_URL, GOOGLE_PLAY_URL } from "../app-download/store-links";
import { resolveSiteUrl, SITE_DESCRIPTION } from "./site-metadata";

function resolveSchemaUrls(siteUrl?: string) {
  const baseUrl = resolveSiteUrl(siteUrl);
  return {
    homepageUrl: `${baseUrl}/`,
    organizationId: `${baseUrl}/#org`,
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
