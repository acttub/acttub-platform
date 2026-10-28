import { NextResponse, type NextRequest } from "next/server";

import {
  decideLandingVariant,
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_COOKIE_MAX_AGE,
  LANDING_VARIANT_PATH_PREFIX,
  LANDING_VARIANT_QUERY,
  landingVariantPath,
} from "@/lib/landing-variant";

/**
 * 랜딩(/) 첫 화면 A/B 배정(SOMA-918). `/` 요청만 받아 쿠키로 안을 정하고 정적 페이지로 다시 쓴다.
 * 안별 페이지는 빌드 때 만들어 두므로 서버 렌더 비용이 늘지 않고, 화면이 바뀌는 깜빡임도 없다.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // 안별 페이지를 주소로 직접 열면 같은 내용이 두 주소로 보인다. 홈으로 돌려보낸다.
  if (pathname.startsWith(LANDING_VARIANT_PATH_PREFIX)) {
    return NextResponse.redirect(new URL("/", request.url), 308);
  }

  const decision = decideLandingVariant({
    forced: request.nextUrl.searchParams.get(LANDING_VARIANT_QUERY),
    cookie: request.cookies.get(LANDING_VARIANT_COOKIE)?.value,
    userAgent: request.headers.get("user-agent"),
    random: Math.random,
  });

  const response = NextResponse.rewrite(new URL(landingVariantPath(decision.variant), request.url));
  if (decision.setCookie) {
    response.cookies.set(LANDING_VARIANT_COOKIE, decision.variant, {
      maxAge: LANDING_VARIANT_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  // 같은 주소가 방문자마다 다르게 나가므로 CDN·브라우저가 한 안을 모두에게 돌려주지 않게 한다.
  response.headers.set("Cache-Control", "private, no-cache, must-revalidate");
  response.headers.set("Vary", "Cookie, User-Agent");
  return response;
}

export const config = { matcher: ["/", "/landing-variants/:path*"] };
