import { ACTTUB_CLIENT, API_BASE_URL } from "../../config/env";
import { endGuestSession, ensureGuestSession } from "../../auth/guest-session";
import { refreshAccessToken } from "../../auth/refresh";
import { getAccessToken, hasGuestSession } from "../../auth/token-store";
import { askConsent } from "./consent-prompt";
import { ApiError, NetworkError, toApiError } from "./errors";
import type { ConsentDocument } from "./types";

export type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  auth?: boolean;
  retryOn401?: boolean;
  /** false 면 403 consent_required 에 시트를 띄우지 않고 그대로 던진다. */
  consentPrompt?: boolean;
  /**
   * false 면 조회가 아니어도 게스트를 만들지 않는다. 이미 있는 게스트의 자료를 다루는
   * 요청(이관 코드 받기)이 쓴다 — 게스트가 없으면 다룰 자료도 없다.
   */
  startGuest?: boolean;
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
  headers.set("X-Acttub-Client", ACTTUB_CLIENT);
  headers.set("X-Acttub-Contract", "three_layers_v1");
  // 서버가 AI 답변과 동의 문서를 어느 말로 낼지 이 값으로 정한다 (SOMA-544).
  // 웹은 아직 한국어 화면뿐이라 한국어로 못박는다 — 브라우저가 보내는 값을 그대로 두면
  // 화면은 한국어인데 약관만 영어로 나오는 기기가 생긴다. 웹을 영어로 열 때 같이 푼다.
  headers.set("Accept-Language", "ko");
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
  throw toApiError(
    response.status,
    payload,
    response.headers.get("X-Request-Id") ?? undefined,
  );
}

// 한 요청이 시트를 띄우는 횟수. 결정하는 사이 새 판이 나오면 한 번 더 묻고, 그래도
// 막히면 403 을 돌려준다 — 끝없이 되묻지 않는다.
const MAX_CONSENT_PROMPTS = 2;

/**
 * 게스트를 만들어도 되는 요청인가. 조회는 아니다 — 게스트가 없으면 볼 자료도 없고,
 * 화면을 여는 것만으로 서버에 계정이 생기면 안 된다(account.guest). 게스트는 배우가
 * 무언가를 하려 할 때(영상 올리기, 대본 등록) 생긴다.
 */
function startsGuest(options: ApiFetchOptions): boolean {
  return options.startGuest !== false && (options.method ?? "GET") !== "GET";
}

function sessionAccess(
  options: ApiFetchOptions,
): string | null | Promise<string> {
  if (hasGuestSession()) return getAccessToken();
  if (startsGuest(options)) return ensureGuestSession();
  throw new ApiError(401, "guest_session_required", "guest_session_required");
}

/** 그 상태 코드로 온 응답의 사유 코드. 상태가 다르거나 본문에 코드가 없으면 null. */
function detailOf(
  response: Response,
  payload: unknown,
  status: number,
): string | null {
  if (response.status !== status) return null;
  if (payload === null || typeof payload !== "object") return null;
  const { detail } = payload as { detail?: unknown };
  return typeof detail === "string" ? detail : null;
}

/** 403 consent_required 에 함께 실려 오는 빠진 문서 목록. 다른 응답이면 null. */
function pendingConsents(
  response: Response,
  payload: unknown,
): ConsentDocument[] | null {
  if (response.status !== 403) return null;
  if (payload === null || typeof payload !== "object") return null;
  const { detail, pending_consents: pending } = payload as {
    detail?: unknown;
    pending_consents?: unknown;
  };
  if (detail !== "consent_required" || !Array.isArray(pending)) return null;
  return pending.length > 0 ? (pending as ConsentDocument[]) : null;
}

async function sendWithSession(
  path: string,
  options: ApiFetchOptions,
  body: string | undefined,
): Promise<{ response: Response; payload: unknown }> {
  const auth = options.auth ?? true;
  const retryOn401 = options.retryOn401 ?? true;
  // 게스트가 이미 있으면 기다리지 않는다 — 요청은 부른 그 틱에 나가야 호출자가 곧바로
  // 건 취소가 진행 중인 fetch 에 닿는다.
  const session = auth ? sessionAccess(options) : null;
  const failedAccess = session instanceof Promise ? await session : session;

  let response = await fetchResponse(path, options, body, failedAccess);
  let payload = await responsePayload(response);

  if (response.status === 401 && auth && retryOn401) {
    let renewedAccess = await refreshAccessToken(failedAccess ?? undefined);
    // 갱신이 거절된 게스트에는 다시 닿을 수 없다. 하려던 일은 새 게스트로 잇는다.
    if (!renewedAccess && startsGuest(options)) {
      renewedAccess = await ensureGuestSession();
    }
    if (!renewedAccess) throwResponseError(response, payload);

    response = await fetchResponse(path, options, body, renewedAccess);
    payload = await responsePayload(response);
  }

  // 앱으로 옮겨진 게스트의 남은 액세스 토큰. account_deactivated 보다 먼저 가른다. 하려던 일을
  // 새 게스트로 잇지 않는다 — 자료가 앱으로 갔다는 안내를 보고 배우가 새로 시작한다.
  if (auth && detailOf(response, payload, 403) === "guest_transferred") {
    endGuestSession("transferred");
    return { response, payload };
  }

  // 닫힌 계정(30일 뒤 파기된 게스트 등)의 남은 액세스 토큰. 갱신이 거절된 것과 같게 다룬다.
  if (auth && detailOf(response, payload, 403) === "account_deactivated") {
    endGuestSession();
    if (startsGuest(options)) {
      const guestAccess = await ensureGuestSession();
      response = await fetchResponse(path, options, body, guestAccess);
      payload = await responsePayload(response);
    }
  }
  return { response, payload };
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResponse<T>> {
  const body = serializeBody(options.body);

  for (let prompts = 0; ; prompts += 1) {
    const { response, payload } = await sendWithSession(path, options, body);
    if (response.ok) {
      return {
        status: response.status,
        data: payload as T,
        headers: response.headers,
      };
    }

    // 게스트의 기능별 동의: 빠진 문서로 시트를 띄우고, 결정이 끝나면 같은 요청을 다시 보낸다.
    const pending =
      options.consentPrompt === false ? null : pendingConsents(response, payload);
    if (
      !pending ||
      prompts >= MAX_CONSENT_PROMPTS ||
      (await askConsent(pending)) !== "decided"
    ) {
      throwResponseError(response, payload);
    }
  }
}
