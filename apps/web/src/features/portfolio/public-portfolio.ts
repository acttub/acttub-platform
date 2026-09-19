import { ApiError, errorMessage } from "@/lib/api/v2/errors";
import {
  getPublicPortfolio,
  type PublicPortfolio,
} from "@/lib/api/v2/public-portfolio";

// 포트폴리오 공개 페이지가 그리는 것의 순수한 부분(account.portfolio, 결정 I-8).
//
// 주소는 /p/<slug> 다. slug 는 빌드 때 알 수 없으므로 프리렌더한 껍데기 하나(/p)를
// next.config.ts 의 rewrites 로 서빙하고, 브라우저가 경로에서 slug 를 읽는다.

/**
 * 없는 slug, 꺼진 링크, 탈퇴한 사람의 slug, slug 없이 연 /p 가 모두 같은 말을 본다.
 * 그 주소가 있었는지조차 알려 주지 않는다.
 */
export const PORTFOLIO_NOT_FOUND_COPY = {
  title: "페이지를 찾을 수 없어요",
  body: "주소가 바뀌었거나 공유가 꺼져 있을 수 있어요.",
} as const;

export type PortfolioPage =
  | { kind: "found"; portfolio: PublicPortfolio }
  | { kind: "notFound" }
  /** 잠깐의 문제(429·서버 오류·네트워크). 없는 페이지로 꾸미지 않고 다시 시도하게 한다. */
  | { kind: "failed"; message: string };

/** `/p/<slug>` 에서 slug 하나만 읽는다. 한 단계를 넘는 경로와 껍데기(/p)는 slug 가 없다. */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    // 깨진 퍼센트 인코딩. 없는 주소와 같게 다룬다.
    return null;
  }
}

export async function loadPortfolioPage(
  pathname: string,
  signal?: AbortSignal,
): Promise<PortfolioPage> {
  const slug = slugFromPath(pathname);
  if (slug === null) return { kind: "notFound" };
  try {
    return { kind: "found", portfolio: await getPublicPortfolio(slug, { signal }) };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { kind: "notFound" };
    // 끊긴 조회는 부르는 쪽이 버린다. 여기서 실패 화면으로 바꾸지 않는다.
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    return {
      kind: "failed",
      message:
        cause instanceof ApiError && cause.status === 429
          ? errorMessage(cause, "잠시 뒤 다시 시도해 주세요.")
          : "지금은 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    };
  }
}

export type PortfolioFact = { label: string; value: string };

const GENDER_LABELS: Record<string, string> = { female: "여성", male: "남성" };

/**
 * 이름 아래에 나란히 놓는 칸들. 성별이 "선택 안 함"이면 서버가 null 을 주고, 그때는 빈 칸을
 * 두지 않고 칸 자체를 뺀다. 추구하는 방향·경력 구간·목표는 공개 페이지에 없다.
 */
export function portfolioFacts(
  portfolio: Pick<PublicPortfolio, "age"> & { gender: string | null },
): PortfolioFact[] {
  const facts: PortfolioFact[] = [];
  const gender = portfolio.gender ? GENDER_LABELS[portfolio.gender] : undefined;
  if (gender) facts.push({ label: "성별", value: gender });
  facts.push({ label: "나이", value: `만 ${portfolio.age}세` });
  return facts;
}

/**
 * 그릴 수 있는 사진의 주소들. 서버는 저장소가 설정돼 있지 않으면 url 을 null 로 준다
 * (CONTRACT §6-1). 그때는 깨진 그림을 두지 않고 그 사진을 뺀다.
 */
export function portfolioPhotoUrls(
  portfolio: Pick<PublicPortfolio, "photos">,
): string[] {
  return portfolio.photos.flatMap((photo) => (photo.url ? [photo.url] : []));
}

const CREDIT_KIND_LABELS: Record<string, string> = {
  film: "영화",
  drama: "드라마",
  play: "연극",
  musical: "뮤지컬",
  ad: "광고",
  other: "기타",
};

export function creditKindLabel(kind: string): string {
  return CREDIT_KIND_LABELS[kind] ?? CREDIT_KIND_LABELS.other;
}
