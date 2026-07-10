import { jsonHeaders, parseApiResponse } from "./practice";

export type AuthSessionResponse = {
  authenticated: boolean;
  mode: "supabase";
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
  internalReviewConsent: { accepted: boolean };
};

export type AcceptTermsRequest = {
  termsVersion: string;
};

export type AcceptTermsResponse = {
  accepted: true;
  requiredConsentAccepted: true;
  aiProcessingConsentAccepted: true;
  internalReviewConsent: boolean;
  nextPath: string;
};

export async function getAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/v1/auth/session", {
    headers: { Accept: "application/json" },
  });

  return parseApiResponse<AuthSessionResponse>(response);
}

export async function acceptTerms(
  body: AcceptTermsRequest,
): Promise<AcceptTermsResponse> {
  void body;
  const response = await fetch("/api/v1/terms/acceptances", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      requiredConsentAccepted: true,
      aiProcessingConsentAccepted: true,
      internalReviewConsent: false,
    }),
  });

  return parseApiResponse<AcceptTermsResponse>(response);
}
