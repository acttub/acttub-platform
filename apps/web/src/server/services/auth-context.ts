import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TERMS_COOKIE_NAME = "acttub_terms_version";

export class ApiAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "terms_required" | "terms_persistence_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

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

type ProfileConsentRow = {
  status: string | null;
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
  internal_review_consent_at: string | null;
  consent_version: string | null;
};

async function hasLocalTermsCookie(): Promise<boolean> {
  const config = getAppConfig();
  const cookieStore = await cookies();
  return cookieStore.get(TERMS_COOKIE_NAME)?.value === config.termsVersion;
}

function isCurrentAcceptedProfile(profile: ProfileConsentRow | null, termsVersion: string): boolean {
  return Boolean(
    profile &&
      profile.status === "active" &&
      profile.terms_accepted_at &&
      profile.privacy_accepted_at &&
      profile.internal_review_consent_at &&
      profile.consent_version === termsVersion,
  );
}

async function getSupabaseProfileConsent(userId: string): Promise<ProfileConsentRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase!
    .from("profiles")
    .select("status, terms_accepted_at, privacy_accepted_at, internal_review_consent_at, consent_version")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data as ProfileConsentRow | null;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const config = getAppConfig();

  if (!config.supabase.isConfigured) {
    return {
      mode: "local-dev",
      userId: "local-dev-actor",
      email: "local-dev@acttub.invalid",
      termsAccepted: await hasLocalTermsCookie(),
      termsVersion: config.termsVersion,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase!.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const profile = await getSupabaseProfileConsent(data.user.id);

  return {
    mode: "supabase",
    userId: data.user.id,
    email: data.user.email ?? null,
    termsAccepted: isCurrentAcceptedProfile(profile, config.termsVersion),
    termsVersion: config.termsVersion,
  };
}

export async function recordTermsAcceptance(context: AuthContext): Promise<void> {
  const config = getAppConfig();

  if (context.mode === "local-dev") {
    return;
  }

  const timestamp = new Date().toISOString();
  const profile = {
    id: context.userId,
    email: context.email,
    status: "active",
    terms_accepted_at: timestamp,
    privacy_accepted_at: timestamp,
    internal_review_consent_at: timestamp,
    consent_version: config.termsVersion,
    updated_at: timestamp,
  };
  const admin = createSupabaseAdminClient();
  const client = admin ?? (await createSupabaseServerClient());
  const { error } = await client!
    .from("profiles")
    .upsert(profile, { onConflict: "id" });

  if (error) {
    throw new ApiAuthError(
      403,
      "terms_persistence_unavailable",
      "약관 동의 저장소를 준비하지 못했어요. 관리자에게 문의해 주세요.",
    );
  }
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

export async function requireApiAuthenticatedUser(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    throw new ApiAuthError(401, "unauthenticated", "로그인이 필요해요.");
  }

  return context;
}

export async function requireApiTermsAccepted(): Promise<AuthContext> {
  const context = await requireApiAuthenticatedUser();

  if (!context.termsAccepted) {
    throw new ApiAuthError(403, "terms_required", "현재 약관 확인이 필요해요.");
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
