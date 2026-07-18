import { apiFetch } from "./client";
import type {
  ConsentDocumentsResponse,
  ConsentEventResponse,
  ConsentRequest,
} from "./types";

export async function listConsentDocuments(): Promise<ConsentDocumentsResponse> {
  const { data } = await apiFetch<ConsentDocumentsResponse>(
    "/v2/consents/documents",
    { method: "GET", auth: false },
  );
  return data;
}

export async function recordConsent(
  body: ConsentRequest,
): Promise<ConsentEventResponse> {
  const { data } = await apiFetch<ConsentEventResponse>("/v2/consents", {
    method: "POST",
    body,
  });
  return data;
}
