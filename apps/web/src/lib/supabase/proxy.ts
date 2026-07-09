import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config/env";

const PROTECTED_PRACTICE_PATH_PREFIX = "/practice";
const PRACTICE_LOGIN_NEXT_PATH = "/practice";

function isProtectedPracticePath(pathname: string): boolean {
  return (
    pathname === PROTECTED_PRACTICE_PATH_PREFIX ||
    pathname.startsWith(`${PROTECTED_PRACTICE_PATH_PREFIX}/`)
  );
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", PRACTICE_LOGIN_NEXT_PATH);
  return NextResponse.redirect(loginUrl);
}

export async function updateSupabaseSession(request: NextRequest) {
  const config = getAppConfig();
  let response = NextResponse.next({ request });
  const shouldRequireLogin = isProtectedPracticePath(request.nextUrl.pathname);

  if (!config.supabase.isConfigured) {
    return shouldRequireLogin ? redirectToLogin(request) : response;
  }

  const supabase = createServerClient(config.supabase.url, config.supabase.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet = {}) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headersToSet).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  if (shouldRequireLogin && (error || !data?.claims.sub)) {
    return redirectToLogin(request);
  }

  return response;
}
