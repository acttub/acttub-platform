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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const apiError =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : null;
    const message =
      apiError ??
      (typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "요청을 처리하지 못했어요.");
    throw new Error(message);
  }

  return payload as T;
}

export async function getAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/v1/auth/session", {
    headers: { Accept: "application/json" },
  });

  return parseJsonResponse<AuthSessionResponse>(response);
}

export async function acceptTerms(
  body: AcceptTermsRequest,
): Promise<AcceptTermsResponse> {
  void body;
  const response = await fetch("/api/v1/terms/acceptances", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requiredConsentAccepted: true,
      aiProcessingConsentAccepted: true,
      internalReviewConsent: false,
    }),
  });

  return parseJsonResponse<AcceptTermsResponse>(response);
}
