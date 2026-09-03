import { apiFetch } from "./client";
import type {
  ConsentDocumentsResponse,
  ConsentEntryResponse,
  ConsentEventResponse,
  ConsentRequest,
  PendingConsentsResponse,
} from "./types";

export async function listConsentDocuments(
  options: { signal?: AbortSignal } = {},
): Promise<ConsentDocumentsResponse> {
  const { data } = await apiFetch<ConsentDocumentsResponse>(
    "/v2/consents/documents",
    { method: "GET", auth: false, signal: options.signal },
  );
  return data;
}

export async function getPendingConsents(
  options: { signal?: AbortSignal } = {},
): Promise<PendingConsentsResponse> {
  const { data } = await apiFetch<PendingConsentsResponse>(
    "/v2/consents/pending",
    { method: "GET", auth: true, signal: options.signal },
  );
  return data;
}

export async function getConsentEntry(
  options: { signal?: AbortSignal } = {},
): Promise<ConsentEntryResponse> {
  const { data } = await apiFetch<ConsentEntryResponse>(
    "/v2/consents/entry",
    { method: "GET", auth: true, signal: options.signal },
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
