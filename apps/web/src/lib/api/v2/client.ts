import { API_BASE_URL } from "../../config/env";
import { refreshAccessToken } from "../../auth/refresh";
import { emitSessionEvent } from "../../auth/session-events";
import { getAccessToken } from "../../auth/token-store";
import { NetworkError, toApiError } from "./errors";

export type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  auth?: boolean;
  retryOn401?: boolean;
};

export type ApiResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  // 멱등 재시도 계층은 이미 직렬화한 문자열을 넘겨 같은 바이트를 재사용한다.
  return typeof body === "string" ? body : JSON.stringify(body);
}

function requestHeaders(
  source: HeadersInit | undefined,
  body: string | undefined,
  accessToken: string | null,
  auth: boolean,
): Headers {
  const headers = new Headers(source);
  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function fetchResponse(
  path: string,
  options: ApiFetchOptions,
  body: string | undefined,
  accessToken: string | null,
): Promise<Response> {
  const auth = options.auth ?? true;
  try {
    return await fetch(apiUrl(path), {
      method: options.method ?? "GET",
      body,
      headers: requestHeaders(options.headers, body, accessToken, auth),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError("네트워크 요청에 실패했습니다.", { cause: error });
    }
    throw error;
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError("API 응답을 읽는 중 네트워크 연결이 끊어졌습니다.", {
        cause: error,
      });
    }
    throw error;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function throwResponseError(response: Response, payload: unknown): never {
  const error = toApiError(
    response.status,
    payload,
    response.headers.get("X-Request-Id") ?? undefined,
  );
  if (error.status === 403 && error.code === "consent_required") {
    emitSessionEvent("consent-required");
  }
  throw error;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResponse<T>> {
  const auth = options.auth ?? true;
  const retryOn401 = options.retryOn401 ?? true;
  const body = serializeBody(options.body);
  const failedAccess = auth ? getAccessToken() : null;

  let response = await fetchResponse(path, options, body, failedAccess);
  let payload = await responsePayload(response);

  if (response.status === 401 && auth && retryOn401) {
    const refreshedAccess = await refreshAccessToken(failedAccess ?? undefined);
    if (!refreshedAccess) throwResponseError(response, payload);

    response = await fetchResponse(path, options, body, refreshedAccess);
    payload = await responsePayload(response);
  }

  if (!response.ok) throwResponseError(response, payload);

  return {
    status: response.status,
    data: payload as T,
    headers: response.headers,
  };
}
