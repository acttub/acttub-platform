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
    sameAs: ["https://www.instagram.com/acttub_com/"],
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
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "KRW",
    },
    publisher: { "@id": organizationId },
  };
}
