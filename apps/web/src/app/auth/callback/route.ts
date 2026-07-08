import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/services/auth-context";
import { sanitizeOAuthNextPath } from "../oauth-next";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeOAuthNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/terms");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const context = await getAuthContext();

  redirect(context?.termsAccepted ? next : "/terms");
}
