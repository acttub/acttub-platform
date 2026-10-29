/**
 * 랜딩(/) 첫 화면 A/B(SOMA-918). 방문자를 쿠키로 50:50 나누고, 같은 방문자는 계속 같은 안을 본다.
 * 배정은 `src/proxy.ts` 가 서버에서 하고 안마다 미리 만든 정적 페이지로 다시 써 준다(rewrite).
 * 그래서 화면이 A 로 나왔다가 B 로 바뀌는 깜빡임이 없다.
 *
 * - `?hero=a` / `?hero=b` 는 그 요청만 강제로 보여 주고 쿠키를 바꾸지 않는다(확인용).
 * - 검색 봇·미리보기 봇은 항상 A 이고 쿠키를 받지 않는다.
 * - A 는 기존 랜딩 그대로다. B 는 첫 화면과 문구만 다르다.
 */
export const LANDING_VARIANTS = ["a", "b"] as const;
export type LandingVariant = (typeof LANDING_VARIANTS)[number];

export const LANDING_VARIANT_COOKIE = "acttub_landing_hero";
export const LANDING_VARIANT_QUERY = "hero";
/** 180일. 같은 방문자가 오래 같은 안을 보게 한다. */
export const LANDING_VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export function isLandingVariant(value: unknown): value is LandingVariant {
  return value === "a" || value === "b";
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|yeti|daum|bingpreview|facebookexternalhit|facebot|embedly|preview|lighthouse|pagespeed|chrome-lighthouse|kakaotalk-scrap|whatsapp|telegram|discord|slack|linkedin|pinterest|ia_archiver|mediapartners|ahrefs|semrush|curl|wget|python-requests/i;

/** 검색 봇·링크 미리보기·측정 도구. UA 가 비어 있어도 봇으로 본다. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_PATTERN.test(userAgent);
}

export type LandingVariantDecision = {
  variant: LandingVariant;
  /** true 일 때만 응답에 쿠키를 심는다. */
  setCookie: boolean;
};

export function decideLandingVariant(input: {
  forced: string | null | undefined;
  cookie: string | null | undefined;
  userAgent: string | null | undefined;
  random: () => number;
}): LandingVariantDecision {
  // 봇은 강제 값이 있어도 A. 검색 결과에 B 가 올라가지 않게 한다.
  if (isBotUserAgent(input.userAgent)) return { variant: "a", setCookie: false };
  if (isLandingVariant(input.forced)) return { variant: input.forced, setCookie: false };
  if (isLandingVariant(input.cookie)) return { variant: input.cookie, setCookie: false };
  return { variant: input.random() < 0.5 ? "a" : "b", setCookie: true };
}

/** 안마다 미리 만든 정적 페이지 경로. 주소창에는 보이지 않는다. */
export const LANDING_VARIANT_PATH_PREFIX = "/landing-variants";

/** 프록시가 rewrite 하며 요청에 붙이는 표시. `next dev` 의 두 번째 프록시 호출을 직접 접근과 가른다. */
export const LANDING_VARIANT_REWRITE_HEADER = "x-acttub-landing-rewrite";

export function landingVariantPath(variant: LandingVariant): string {
  return `${LANDING_VARIANT_PATH_PREFIX}/${variant}`;
}
