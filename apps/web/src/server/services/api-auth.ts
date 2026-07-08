import "server-only";

import { getAuthContext, type AuthContext } from "@/server/services/auth-context";

export class ApiAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthenticated" | "terms_not_accepted",
    message: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export async function requireApiTermsAccepted(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    throw new ApiAuthError(401, "unauthenticated", "Authentication is required.");
  }

  if (!context.termsAccepted) {
    throw new ApiAuthError(403, "terms_not_accepted", "Current terms acceptance is required.");
  }

  return context;
}
