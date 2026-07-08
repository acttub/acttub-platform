import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeOAuthNextPath } from "../oauth-next";

export async function GET(request: NextRequest) {
  const config = getAppConfig();

  if (!config.supabase.isConfigured) {
    redirect("/terms");
  }

  const supabase = await createSupabaseServerClient();
  const redirectTo = new URL("/auth/callback", request.url).toString();
  const next = sanitizeOAuthNextPath(request.nextUrl.searchParams.get("next"));

  const { data, error } = await supabase!.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${redirectTo}?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return NextResponse.json(
      { error: "로그인 경로를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  redirect(data.url);
}
