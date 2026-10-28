import { NextResponse, type NextRequest } from "next/server";

import {
  decideLandingVariant,
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_COOKIE_MAX_AGE,
  LANDING_VARIANT_PATH_PREFIX,
  LANDING_VARIANT_QUERY,
  LANDING_VARIANT_REWRITE_HEADER,
  landingVariantPath,
} from "@/lib/landing-variant";

/**
 * 랜딩(/) 첫 화면 A/B 배정(SOMA-918). `/` 요청만 받아 쿠키로 안을 정하고 정적 페이지로 다시 쓴다.
 * 안별 페이지는 빌드 때 만들어 두므로 서버 렌더 비용이 늘지 않고, 화면이 바뀌는 깜빡임도 없다.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(LANDING_VARIANT_PATH_PREFIX)) {
    // `next dev` 는 rewrite 한 주소로 프록시를 한 번 더 부른다(`next start` 는 안 부른다). 그때 이 표시가
    // 실려 오므로 그대로 통과시킨다. 표시 없이 안별 페이지를 주소로 직접 열면 같은 내용이 두 주소로
    // 보이니 홈으로 돌려보낸다. 표시를 지어내 직접 열어도 보이는 건 공개 랜딩뿐이다.
    if (request.headers.get(LANDING_VARIANT_REWRITE_HEADER) === "1") return NextResponse.next();
    return NextResponse.redirect(new URL("/", request.url), 308);
  }

  const decision = decideLandingVariant({
    forced: request.nextUrl.searchParams.get(LANDING_VARIANT_QUERY),
    cookie: request.cookies.get(LANDING_VARIANT_COOKIE)?.value,
    userAgent: request.headers.get("user-agent"),
    random: Math.random,
  });

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(LANDING_VARIANT_REWRITE_HEADER, "1");
  const response = NextResponse.rewrite(new URL(landingVariantPath(decision.variant), request.url), {
    request: { headers: forwardedHeaders },
  });
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
