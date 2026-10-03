import { apiFetch } from "./client";

import type { components } from "../v2-schema";

/** 실제 URL의 안전 UTM만 정식 서버 계약 이름으로 옮긴다. */
export type WebAttributionRequest = components["schemas"]["WebAttributionRequest"];

/**
 * 이 게스트의 웹 최초 유입을 저장한다. 서버가 source=web_utm, platform=web을 고정하고
 * 최초 값만 받는다. 이미 있는 게스트와 현재 privacy 동의가 확인된 뒤에만 부른다.
 *
 * 백그라운드 귀속 저장 때문에 게스트나 동의 시트를 새로 만들지 않는다. 그 사이 동의가
 * 바뀌었으면 403을 그대로 받아 호출자가 닫힌 쪽으로 실패한다.
 */
export async function putWebAttribution(
  body: WebAttributionRequest,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  await apiFetch<void>("/v2/me/web-attribution", {
    method: "PUT",
    body,
    signal: options.signal,
    startGuest: false,
    consentPrompt: false,
  });
}
