import { ACTTUB_CLIENT, API_BASE_URL } from "../../config/env";
import { parsePayload } from "../../auth/auth-request";
import { ApiError, NetworkError, responseError } from "./errors";

// PG 심사 전용 테스트 결제 API (SOMA-620). 계약은 /v2/pg-review/* 이다.
//
// ⚠ 공용 클라이언트(apiFetch)를 일부러 쓰지 않는다. 이 API 는 앱 계정이 아니라 심사 전용
//   HttpOnly 쿠키 세션으로만 인증한다. apiFetch 를 거치면 개인·게스트 JWT 를 자동으로 만들고
//   401 에 갱신·게스트 재생성까지 하므로, 심사용 로그인과 실제 앱 계정이 섞인다.
//   그래서 Authorization 을 붙이지 않고 401 도 다시 시도하지 않는다.
// ⚠ authKey·billingKey·카드 정보는 이 모듈이 만지지 않는다. 토스가 서버 콜백(/v2/pg-review/success)으로
//   보내고 Spring 이 처리한다. 브라우저는 결과의 안전한 요약만 읽는다.

export const PG_REVIEW_AMOUNT = 3900;

export type PgReviewConfig = {
  available: boolean;
  authenticated: boolean;
  testOnly: true;
  amount: number;
};

export type PgReviewCheckout = {
  clientKey: string;
  customerKey: string;
  successUrl: string;
  failUrl: string;
};

export type PgReviewStatus = "idle" | "processing" | "approved" | "failed" | "unknown";

export type PgReviewResult = {
  status: PgReviewStatus;
  testOnly: true;
  amount: number;
  orderId?: string;
  approvedAt?: string;
  errorCode?: string;
  message?: string;
};

const STATUSES: readonly PgReviewStatus[] = ["idle", "processing", "approved", "failed", "unknown"];

/** 이 API 가 닫혀 있을 때(404) 화면이 보는 설정. */
const UNAVAILABLE: PgReviewConfig = {
  available: false,
  authenticated: false,
  testOnly: true,
  amount: PG_REVIEW_AMOUNT,
};

async function pgReviewFetch(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<{ response: Response; payload: unknown }> {
  const headers = new Headers({ "X-Acttub-Client": ACTTUB_CLIENT, "Accept-Language": "ko" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v2/pg-review${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // 심사 전용 쿠키 세션. 같은 출처가 기본이고, 다른 출처 API 를 쓸 때만 쿠키가 필요하다.
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError("심사용 결제 요청에 실패했습니다.", { cause: error });
    }
    throw error;
  }
  const payload = await parsePayload(response, "심사용 결제");
  return { response, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function malformed(response: Response): ApiError {
  return new ApiError(response.status, "malformed_response", "malformed_response");
}

export async function getPgReviewConfig(signal?: AbortSignal): Promise<PgReviewConfig> {
  const { response, payload } = await pgReviewFetch("/config", { signal });
  // 닫힌 환경(ACTTUB_PG_REVIEW_ENABLED=false)은 404 다. 오류가 아니라 "열려 있지 않음"이다.
  if (response.status === 404) return UNAVAILABLE;
  if (!response.ok) throw responseError(response, payload);
  if (!isRecord(payload) || typeof payload.available !== "boolean") throw malformed(response);
  return {
    available: payload.available,
    authenticated: payload.authenticated === true,
    testOnly: true,
    amount: PG_REVIEW_AMOUNT,
  };
}

export async function loginPgReview(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<void> {
  const { response, payload } = await pgReviewFetch("/login", {
    method: "POST",
    body: { username, password },
    signal,
  });
  if (!response.ok) throw responseError(response, payload);
  if (!isRecord(payload) || payload.authenticated !== true) throw malformed(response);
}

export async function createPgReviewCheckout(signal?: AbortSignal): Promise<PgReviewCheckout> {
  const { response, payload } = await pgReviewFetch("/checkout", { method: "POST", signal });
  if (!response.ok) throw responseError(response, payload);
  if (
    !isRecord(payload) ||
    typeof payload.clientKey !== "string" ||
    typeof payload.customerKey !== "string" ||
    typeof payload.successUrl !== "string" ||
    typeof payload.failUrl !== "string"
  ) {
    throw malformed(response);
  }
  return {
    clientKey: payload.clientKey,
    customerKey: payload.customerKey,
    successUrl: payload.successUrl,
    failUrl: payload.failUrl,
  };
}

export async function getPgReviewResult(signal?: AbortSignal): Promise<PgReviewResult> {
  const { response, payload } = await pgReviewFetch("/result", { signal });
  if (!response.ok) throw responseError(response, payload);
  if (
    !isRecord(payload) ||
    typeof payload.status !== "string" ||
    !STATUSES.includes(payload.status as PgReviewStatus)
  ) {
    throw malformed(response);
  }
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    status: payload.status as PgReviewStatus,
    testOnly: true,
    amount: PG_REVIEW_AMOUNT,
    orderId: text(payload.orderId),
    approvedAt: text(payload.approvedAt),
    errorCode: text(payload.errorCode),
    message: text(payload.message),
  };
}

export async function logoutPgReview(): Promise<void> {
  const { response, payload } = await pgReviewFetch("/logout", { method: "POST" });
  if (!response.ok && response.status !== 401) throw responseError(response, payload);
}
