import "server-only";

import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TERMS_COOKIE_NAME = "acttub_terms_version";

export class ApiAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "terms_required",
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

async function getProfileClient() {
  return createSupabaseAdminClient() ?? (await createSupabaseServerClient());
}

async function hasPersistedTermsAcceptance(userId: string): Promise<boolean> {
  const config = getAppConfig();
  const client = await getProfileClient();

  if (!client) return false;

  const { data, error } = await client
    .from("profiles")
    .select("status, consent_version, terms_accepted_at, privacy_accepted_at, internal_review_consent_at")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;

  return (
    data.status === "active" &&
    data.consent_version === config.termsVersion &&
    Boolean(data.terms_accepted_at) &&
    Boolean(data.privacy_accepted_at) &&
    Boolean(data.internal_review_consent_at)
  );
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

  const client = await getProfileClient();
  if (!client) return;

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

export async function recordTermsAcceptance(context: AuthContext): Promise<void> {
  const config = getAppConfig();
  const client = await getProfileClient();
  if (!client) return;

  const acceptedAt = new Date().toISOString();
  const { error } = await client.from("profiles").upsert(
    {
      id: context.userId,
      email: context.email,
      status: "active",
      terms_accepted_at: acceptedAt,
      privacy_accepted_at: acceptedAt,
      internal_review_consent_at: acceptedAt,
      consent_version: config.termsVersion,
      updated_at: acceptedAt,
    },
    { onConflict: "id" },
  );

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

  return {
    mode: "supabase",
    userId: data.user.id,
    email: data.user.email ?? null,
    termsAccepted: await hasPersistedTermsAcceptance(data.user.id),
    termsVersion: config.termsVersion,
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
      requiredVersion: config.termsVersion,
      accepted: Boolean(context?.termsAccepted),
    },
  };
}
