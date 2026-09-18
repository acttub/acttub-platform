import type { Metadata } from "next";
import type { KeywordPageContent } from "@/features/keyword-pages/types";

const DEFAULT_SITE_URL = "https://acttub.com";
const DEFAULT_TITLE = "Acttub — AI 연기 코칭, 질문으로 다시 보는 연기 연습";

export const SITE_DESCRIPTION =
  "AI 연기 코칭 앱 Acttub. 내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연기 연습 도구예요.";

// 검색엔진 소유권 확인 값은 페이지 소스에 그대로 공개되는 값이라 코드에 둔다.
export const GOOGLE_SITE_VERIFICATION =
  "zABzA1FHYUFDJR1hJmCKZqAdJDjZ7-Tz_zhWpOZ8hzg";
export const NAVER_SITE_VERIFICATION =
  "697b757ca85289cefc70141c0a879284c3ef8563";

export function buildVerification(google: string, naver: string) {
  return {
    google,
    ...(naver ? { other: { "naver-site-verification": naver } } : {}),
  };
}

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
    verification: buildVerification(
      GOOGLE_SITE_VERIFICATION,
      NAVER_SITE_VERIFICATION,
    ),
  };
}

export function buildKeywordPageMetadata(
  content: Pick<KeywordPageContent, "path" | "title" | "description">,
  siteUrl?: string,
): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const rootMetadata = buildRootMetadata(resolvedSiteUrl);

  return {
    ...rootMetadata,
    title: content.title,
    description: content.description,
    alternates: {
      canonical: content.path,
    },
    openGraph: {
      ...rootMetadata.openGraph,
      type: "article",
      url: `${resolvedSiteUrl}${content.path}`,
      title: `${content.title} | Acttub`,
      description: content.description,
    },
  };
}

const GUIDE_INDEX_TITLE =
  "연기 연습 가이드 — 독백·셀프테이프·입시·독학 루틴";
const GUIDE_INDEX_DESCRIPTION =
  "혼자 하는 연기 연습을 위한 가이드예요. 독백 연습법, 셀프테이프 찍는 법, 자유연기 작품 고르기, 연기 독학 루틴, 연기학원 고르는 법, 연극영화과 입시 준비 순서, 장면 분석, 내 영상 다시 보는 법을 정리했어요.";

export function buildGuideIndexMetadata(siteUrl?: string): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const rootMetadata = buildRootMetadata(resolvedSiteUrl);

  return {
    ...rootMetadata,
    title: GUIDE_INDEX_TITLE,
    description: GUIDE_INDEX_DESCRIPTION,
    alternates: { canonical: "/guide" },
    openGraph: {
      ...rootMetadata.openGraph,
      type: "website",
      url: `${resolvedSiteUrl}/guide`,
      title: `${GUIDE_INDEX_TITLE} | Acttub`,
      description: GUIDE_INDEX_DESCRIPTION,
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
