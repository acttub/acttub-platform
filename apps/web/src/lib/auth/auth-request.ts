import { ACTTUB_CLIENT, API_BASE_URL } from "../config/env";
import { NetworkError } from "../api/v2/errors";

// 토큰을 받는 두 요청(갱신·게스트 만들기)은 공용 클라이언트 아래에서 돈다 — 공용
// 클라이언트가 401·토큰 없음을 만나 이것을 부르므로 그 위를 지나면 돌고 돈다.

export type AuthResponse = {
  response: Response;
  payload: unknown;
};

async function parsePayload(response: Response, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError(`${what} 응답을 읽는 중 네트워크 연결이 끊어졌습니다.`, {
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

export async function postAuth(
  path: string,
  what: string,
  body?: unknown,
): Promise<AuthResponse> {
  const headers: Record<string, string> = { "X-Acttub-Client": ACTTUB_CLIENT };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError(`${what} 요청에 실패했습니다.`, { cause: error });
    }
    throw error;
  }
  return { response, payload: await parsePayload(response, what) };
}
