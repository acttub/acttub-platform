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
    // 사이트는 항상 도메인 루트에서 서빙된다(basePath 없음) — path·인증정보·
    // query·fragment가 섞인 값은 배포 오설정이므로 origin만 취한다.
    return url.origin;
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

export const APP_DOWNLOAD_TITLE = "앱 다운로드";

export const APP_DOWNLOAD_DESCRIPTION =
  "acttub 앱을 App Store와 Google Play에서 받을 수 있어요. 연습실에서 찍은 영상을 폰에서 바로 올리고 질문에 말로 답해요.";

/**
 * `/app`은 랜딩과 함께 색인되는 두 번째 공개 페이지다. 인스타그램 프로필 링크가 이 주소를
 * 가리키므로 공유 카드(og)가 랜딩과 달라야 한다.
 */
export function buildAppDownloadMetadata(siteUrl?: string): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const rootMetadata = buildRootMetadata(resolvedSiteUrl);

  return {
    ...rootMetadata,
    title: APP_DOWNLOAD_TITLE,
    description: APP_DOWNLOAD_DESCRIPTION,
    alternates: {
      canonical: "/app",
    },
    openGraph: {
      ...rootMetadata.openGraph,
      url: `${resolvedSiteUrl}/app`,
      title: `${APP_DOWNLOAD_TITLE} | Acttub`,
      description: APP_DOWNLOAD_DESCRIPTION,
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
