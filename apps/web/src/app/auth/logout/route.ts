import { NextResponse, type NextRequest } from "next/server";
import { TERMS_COOKIE_NAME } from "@/server/services/auth-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.delete(TERMS_COOKIE_NAME);
  return response;
}
