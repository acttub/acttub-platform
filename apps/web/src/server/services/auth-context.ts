import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TERMS_COOKIE_NAME = "acttub_terms_version";

export type AuthContext = {
  mode: "local-dev" | "supabase";
  userId: string;
  email: string | null;
  termsAccepted: boolean;
  termsVersion: string;
};

export type AuthSessionDto = {
  authenticated: boolean;
  mode: AuthContext["mode"];
  user: {
    id: string;
    email: string | null;
  } | null;
  terms: {
    requiredVersion: string;
    accepted: boolean;
  };
};

async function hasAcceptedTerms(): Promise<boolean> {
  const config = getAppConfig();
  const cookieStore = await cookies();
  return cookieStore.get(TERMS_COOKIE_NAME)?.value === config.termsVersion;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const config = getAppConfig();
  const termsAccepted = await hasAcceptedTerms();

  if (!config.supabase.isConfigured) {
    return {
      mode: "local-dev",
      userId: "local-dev-actor",
      email: "local-dev@acttub.invalid",
      termsAccepted,
      termsVersion: config.termsVersion,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase!.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return {
    mode: "supabase",
    userId: data.user.id,
    email: data.user.email ?? null,
    termsAccepted,
    termsVersion: config.termsVersion,
  };
}

export async function requireAuthenticatedUser(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    redirect("/auth/login");
  }

  return context;
}

export async function requireTermsAccepted(): Promise<AuthContext> {
  const context = await requireAuthenticatedUser();

  if (!context.termsAccepted) {
    redirect("/terms");
  }

  return context;
}

export function toAuthSessionDto(context: AuthContext | null): AuthSessionDto {
  const config = getAppConfig();

  return {
    authenticated: Boolean(context),
    mode: context?.mode ?? (config.supabase.isConfigured ? "supabase" : "local-dev"),
    user: context
      ? {
          id: context.userId,
          email: context.email,
        }
      : null,
    terms: {
      requiredVersion: config.termsVersion,
      accepted: Boolean(context?.termsAccepted),
    },
  };
}
