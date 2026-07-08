export type AuthSessionResponse = {
  authenticated: boolean;
  mode: "local-dev" | "supabase";
  user: {
    id: string;
    email: string | null;
  } | null;
  terms: {
    requiredVersion: string;
    accepted: boolean;
  };
};

export type AcceptTermsRequest = {
  termsVersion: string;
};

export type AcceptTermsResponse = {
  accepted: true;
  termsVersion: string;
  nextPath: string;
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | { error: string };

  if (!response.ok) {
    const message = "error" in payload ? payload.error : "요청을 처리하지 못했어요.";
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
  const response = await fetch("/api/v1/terms/acceptances", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<AcceptTermsResponse>(response);
}
