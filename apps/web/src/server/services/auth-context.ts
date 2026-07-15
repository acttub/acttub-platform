import "server-only";

import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TERMS_COOKIE_NAME = "acttub_terms_version";

export class ApiAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "terms_required" | "account_suspended",
    message: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export type AuthContext = {
  mode: "supabase";
  userId: string;
  email: string | null;
  termsAccepted: boolean;
  termsVersion: string;
  aiProcessingConsentVersion: string;
  internalReviewConsent: boolean;
};

export type CurrentConsentVersions = {
  requiredConsentVersion: string;
  aiProcessingConsentVersion: string;
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
  aiProcessingConsent: {
    requiredVersion: string | null;
    accepted: boolean;
  };
  internalReviewConsent: {
    accepted: boolean;
  };
};

async function getProfileClient() {
  return createSupabaseAdminClient() ?? (await createSupabaseServerClient());
}

async function hasPersistedTermsAcceptance(userId: string): Promise<boolean> {
  const client = await getProfileClient();

  if (!client) return false;

  let versions: CurrentConsentVersions;
  try {
    versions = await getCurrentConsentVersions();
  } catch {
    return false;
  }
  const { data, error } = await client
    .from("profiles")
    .select("status, required_consent_version, required_consent_at, ai_processing_consent_version, ai_processing_consent_at")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;

  return (
    data.status === "active" &&
    data.required_consent_version === versions.requiredConsentVersion &&
    Boolean(data.required_consent_at) &&
    data.ai_processing_consent_version === versions.aiProcessingConsentVersion &&
    Boolean(data.ai_processing_consent_at)
  );
}

export async function getCurrentConsentVersions(): Promise<CurrentConsentVersions> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new ApiAuthError(403, "terms_required", "Current terms acceptance is required.");
  }
  const [required, ai] = await Promise.all([
    client.rpc("current_acttub_terms_version"),
    client.rpc("current_acttub_ai_processing_consent_version"),
  ]);
  if (required.error || ai.error || typeof required.data !== "string" || typeof ai.data !== "string") {
    throw new ApiAuthError(403, "terms_required", "Current terms acceptance is required.");
  }
  return { requiredConsentVersion: required.data, aiProcessingConsentVersion: ai.data };
}

function isDuplicateProfileError(error: { code?: string; message?: string }) {
  return (
    error.code === "23505" ||
    error.message?.toLowerCase().includes("duplicate key")
  );
}

export async function ensurePendingProfile(
  user: Pick<AuthContext, "userId" | "email">,
): Promise<void> {
  const config = getAppConfig();
  if (!config.supabase.isConfigured) return;

  const client = createSupabaseAdminClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to create profiles.");
  }

  const now = new Date().toISOString();
  const { error } = await client.from("profiles").insert({
    id: user.userId,
    email: user.email,
    status: "pending_terms",
    updated_at: now,
  });

  if (error && !isDuplicateProfileError(error)) {
    throw error;
  }
}

export async function recordTermsAcceptance(
  context: AuthContext,
  internalReviewConsent = false,
): Promise<void> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new ApiAuthError(403, "terms_required", "Current terms acceptance is required.");
  }

  const acceptedAt = new Date().toISOString();
  const versions = await getCurrentConsentVersions();
  const { error } = await client.rpc("acttub_accept_terms", {
    p_user_id: context.userId,
    p_required_consent_version: versions.requiredConsentVersion,
    p_ai_processing_consent_version: versions.aiProcessingConsentVersion,
    p_internal_review_consent: internalReviewConsent,
    p_accepted_at: acceptedAt,
  });

  if (error?.code === "PT403" || error?.message.includes("account_suspended")) {
    throw new ApiAuthError(403, "account_suspended", "This account is suspended.");
  }
  if (error?.message.includes("consent_version_mismatch")) {
    throw new ApiAuthError(403, "terms_required", "Current terms acceptance is required.");
  }
  if (error) throw error;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const config = getAppConfig();
  if (!config.supabase.isConfigured) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase!.auth.getUser();

  if (error || !data.user) return null;

  await ensurePendingProfile({
    userId: data.user.id,
    email: data.user.email ?? null,
  });

  let versions: CurrentConsentVersions;
  try {
    versions = await getCurrentConsentVersions();
  } catch {
    versions = {
      requiredConsentVersion: config.termsVersion,
      aiProcessingConsentVersion: "",
    };
  }

  const client = await getProfileClient();
  const profileResult = client
    ? await client
        .from("profiles")
        .select("internal_review_consent")
        .eq("id", data.user.id)
        .maybeSingle()
    : { data: null, error: null };

  return {
    mode: "supabase",
    userId: data.user.id,
    email: data.user.email ?? null,
    termsAccepted: await hasPersistedTermsAcceptance(data.user.id),
    termsVersion: versions.requiredConsentVersion,
    aiProcessingConsentVersion: versions.aiProcessingConsentVersion,
    internalReviewConsent: Boolean(profileResult.data?.internal_review_consent),
  };
}

export async function requireAuthenticatedUser(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) redirect("/auth/login");

  return context;
}

export async function requireTermsAccepted(): Promise<AuthContext> {
  const context = await requireAuthenticatedUser();

  if (!context.termsAccepted) redirect("/terms");

  return context;
}

export async function requireApiAuthenticatedUser(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    throw new ApiAuthError(401, "unauthenticated", "Authentication is required.");
  }

  return context;
}

export async function requireApiTermsAccepted(): Promise<AuthContext> {
  const context = await requireApiAuthenticatedUser();

  if (!context.termsAccepted) {
    throw new ApiAuthError(403, "terms_required", "Current terms acceptance is required.");
  }

  return context;
}

export function toAuthSessionDto(context: AuthContext | null): AuthSessionDto {
  const config = getAppConfig();

  return {
    authenticated: Boolean(context),
    mode: "supabase",
    user: context
      ? {
          id: context.userId,
          email: context.email,
        }
      : null,
    terms: {
      requiredVersion: context?.termsVersion ?? config.termsVersion,
      accepted: Boolean(context?.termsAccepted),
    },
    aiProcessingConsent: {
      requiredVersion: context?.aiProcessingConsentVersion || null,
      accepted: Boolean(context?.termsAccepted),
    },
    internalReviewConsent: {
      accepted: Boolean(context?.internalReviewConsent),
    },
  };
}
