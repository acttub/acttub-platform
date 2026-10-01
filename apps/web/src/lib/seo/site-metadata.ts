import type { Metadata } from "next";
import type { KeywordPageContent } from "@/features/keyword-pages/types";
import { loadAdmissionsStatic } from "@/features/admissions/admissions-static";
import type { AdmissionsResponse } from "@/lib/api/v2/admissions";

const DEFAULT_SITE_URL = "https://acttub.com";
/**
 * 한글 표기. 스토어 앱 이름이 "Acttub(액터브)"라 본문 표기는 "액터브"로 맞춘다.
 * "엑터브"는 사람들이 실제로 치는 오타 변형이라 구조화 데이터의 alternateName 에만 둔다
 * (본문에 둘 다 적으면 문서가 지저분해지고, 구글은 alternateName 으로 같은 브랜드임을 안다).
 */
export const BRAND_ALTERNATE_NAMES = ["액터브", "엑터브"] as const;

const DEFAULT_TITLE =
  "Acttub(액터브) — AI 연기 코칭, 질문으로 다시 보는 연기 연습";

export const SITE_DESCRIPTION =
  "AI 연기 코칭 앱 Acttub(액터브). 내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연기 연습 도구예요.";

// 검색엔진 소유권 확인 값은 페이지 소스에 그대로 공개되는 값이라 코드에 둔다.
const GOOGLE_SITE_VERIFICATION =
  "zABzA1FHYUFDJR1hJmCKZqAdJDjZ7-Tz_zhWpOZ8hzg";
const NAVER_SITE_VERIFICATION =
  "697b757ca85289cefc70141c0a879284c3ef8563";

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
    verification: {
      google: GOOGLE_SITE_VERIFICATION,
      other: { "naver-site-verification": NAVER_SITE_VERIFICATION },
    },
  };
}

/**
 * 공개 페이지 하나의 metadata. 루트 값 위에 canonical과 공유 카드(og)를 그 페이지 것으로 덮는다.
 * 제목이 없으면(랜딩) 루트의 제목·설명을 그대로 둔다 — undefined 로 덮으면 루트 title 템플릿이 사라진다.
 */
function buildPageMetadata(
  page: {
    path: string;
    title?: string;
    description?: string;
    type?: "article" | "website";
  },
  siteUrl?: string,
): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const rootMetadata = buildRootMetadata(resolvedSiteUrl);
  const { path, title, description, type = "website" } = page;

  return {
    ...rootMetadata,
    ...(title === undefined ? {} : { title, description }),
    alternates: { canonical: path },
    openGraph: {
      ...rootMetadata.openGraph,
      type,
      url: `${resolvedSiteUrl}${path}`,
      ...(title === undefined
        ? {}
        : { title: `${title} | Acttub`, description }),
    },
  };
}

export function buildKeywordPageMetadata(
  content: Pick<KeywordPageContent, "path" | "title" | "description">,
  siteUrl?: string,
): Metadata {
  return buildPageMetadata({ ...content, type: "article" }, siteUrl);
}

// 검색 결과 문구. 이 페이지로 노출되는 검색어가 "연기 연습"이라(서치콘솔 2026-09-24) 그 말로
// 시작하고, 글 목록을 늘어놓는 대신 무엇을 따라 할 수 있는지 적는다 — 목록형 설명일 때
// 노출 14회에 클릭이 1회였다. 모바일 결과에서 잘리지 않게 100자 안쪽으로 둔다.
const GUIDE_INDEX_TITLE =
  "혼자 하는 연기 연습 방법 — 독백·셀프테이프·입시 준비";
const GUIDE_INDEX_DESCRIPTION =
  "학원 없이 혼자 하는 연기 연습을 순서대로 정리했어요. 독백 6단계, 폰으로 찍는 셀프테이프, 자유연기 작품 고르기, 매일 30분 독학 루틴까지 따라 해 보세요.";

export function buildGuideIndexMetadata(siteUrl?: string): Metadata {
  return buildPageMetadata(
    { path: "/guide", title: GUIDE_INDEX_TITLE, description: GUIDE_INDEX_DESCRIPTION },
    siteUrl,
  );
}

export function buildLandingMetadata(siteUrl?: string): Metadata {
  return buildPageMetadata({ path: "/" }, siteUrl);
}

// "앱 다운로드"만으로는 검색 결과에서 무엇을 하는 앱인지 안 보인다. 이 페이지가 가장 많이
// 노출되는데(서치콘솔 2026-09-24 노출 17) 그 검색어는 브랜드와 "AI 연기 코칭"이다.
// 루트 템플릿이 " | Acttub"을 붙이므로 영문 브랜드는 여기서 반복하지 않는다.
const APP_DOWNLOAD_TITLE = "AI 연기 코칭 앱 액터브 — iOS·Android 무료";

const APP_DOWNLOAD_DESCRIPTION =
  "연기 영상을 폰에서 올리면 AI가 장면 속 순간을 짚어 질문해요. 말로 답하면 다음 테이크에서 붙잡을 문장이 연습 노트로 남아요. App Store·Google Play 무료.";

/**
 * `/app`은 랜딩과 함께 색인되는 두 번째 공개 페이지다. 인스타그램 프로필 링크가 이 주소를
 * 가리키므로 공유 카드(og)가 랜딩과 달라야 한다.
 */
export function buildAppDownloadMetadata(siteUrl?: string): Metadata {
  return buildPageMetadata(
    { path: "/app", title: APP_DOWNLOAD_TITLE, description: APP_DOWNLOAD_DESCRIPTION },
    siteUrl,
  );
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

export function buildAdmissionsIndexMetadata(siteUrl?: string): Metadata {
  const title = "연극영화과 입시 정보 — 대학별 모집요강·실기·일정 정리";
  const count = loadAdmissionsStatic().universities.length;
  const description = `전국 연극영화과·연기 전공 ${count}개 대학의 모집요강, 실기 과제, 원서 접수 일정을 한곳에 정리했어요. 최종 확인은 각 대학 입학처 공고로 해주세요.`;

  return buildPageMetadata({ path: "/admissions", title, description }, siteUrl);
}

export function buildUniversityAdmissionsMetadata(
  payload: AdmissionsResponse,
  siteUrl?: string,
): Metadata {
  const university = payload.universities[0];
  const title = `${university.name} 연기 입시 정보 — 모집요강·실기·일정`;
  const departments = [
    ...new Set(payload.notices.map(({ department }) => department).filter(Boolean)),
  ].slice(0, 3);
  const tracks = [
    ...new Set(payload.notices.map(({ track }) => track).filter(Boolean)),
  ];
  const years = payload.notices
    .map(({ admission_year }) => admission_year)
    .filter((year): year is number => typeof year === "number");
  const description = payload.notices.length
    ? `${university.name} ${departments.join(" · ")} ${Math.max(...years)}학년도 ${tracks.join(" · ")} 전형의 실기 과제와 접수 일정을 정리했어요. 최종 확인은 대학 입학처 공고로 해주세요.`
    : `${university.name} 연기 전공 입시 정보를 정리했어요. 최종 확인은 대학 입학처 공고로 해주세요.`;
  return buildPageMetadata(
    { path: `/admissions/${university.id}`, title, description },
    siteUrl,
  );
}
