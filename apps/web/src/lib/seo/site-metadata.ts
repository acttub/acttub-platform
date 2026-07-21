import type { Metadata } from "next";

const DEFAULT_SITE_URL = "https://acttub.com";
const DEFAULT_TITLE = "Acttub — 질문으로 다시 보는 연기 연습";

export const SITE_DESCRIPTION =
  "내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연습 도구예요.";

export function resolveSiteUrl(raw?: string): string {
  const candidate =
    raw === undefined ? process.env.NEXT_PUBLIC_SITE_URL : raw;

  if (!candidate?.trim()) return DEFAULT_SITE_URL;

  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_SITE_URL;
    }
    // query/fragment가 남으면 `${siteUrl}/` 결합이 malformed URL을 만든다.
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function buildRootMetadata(siteUrl?: string): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);

  return {
    metadataBase: new URL(resolvedSiteUrl),
    title: {
      default: DEFAULT_TITLE,
      template: "%s | Acttub",
    },
    description: SITE_DESCRIPTION,
    openGraph: {
      siteName: "Acttub",
      locale: "ko_KR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export function buildLandingMetadata(siteUrl?: string): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const rootMetadata = buildRootMetadata(resolvedSiteUrl);

  return {
    ...rootMetadata,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      ...rootMetadata.openGraph,
      url: `${resolvedSiteUrl}/`,
    },
  };
}

export function buildNoindexMetadata(title?: string): Metadata {
  return {
    ...(title ? { title } : {}),
    robots: {
      index: false,
      follow: false,
    },
  };
}
